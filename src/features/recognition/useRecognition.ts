import type { PhotoRecognitionItem } from './photoApi';
import { useState } from 'react';
import type { ReceiptResult } from '../receipt/parseReceipt';
import { categoryImage } from '../ingredients/images';
import { classifyIngredient, matchIngredient } from '../ingredients/classify';

export type RecognizedItem = { id: number; name: string; quantity: number; category: string; image: string; error: boolean; corrected: boolean };

const pad = (value: number) => String(value).padStart(2, '0');
const now = () => {
  const date = new Date();
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
};

export function useRecognition() {
  const [source, setSource] = useState<'camera' | 'receipt'>('camera');
  const [items, setItems] = useState<RecognizedItem[]>([]);
  const [editing, setEditing] = useState('0');
  const [pendingName, setPendingName] = useState('');
  const [date, setDate] = useState(now().date);
  const [time, setTime] = useState(now().time);
  const start = (next: RecognizedItem[], at: { date: string; time: string }) => {
    setItems(next);
    setEditing(String(next[0]?.id ?? 0));
    setPendingName(next[0]?.name ?? '');
    setDate(at.date);
    setTime(at.time);
  };
  return {
    source, items, editing, pendingName, date, time, setDate, setTime,
    selectEdit: (id: number) => {
      setEditing(String(id));
      setPendingName(items.find(item => item.id === id)?.name ?? '');
    },
    saveName: (id: number, value: string) => {
      const name = value.trim();
      if (!name) return;
      // 이름이 바뀌면 카테고리와 썸네일도 다시 정한다.
      const category = classifyIngredient(name);
      setItems(current => current.map(item => item.id === id ? { ...item, name, category, image: categoryImage(category), corrected: true } : item));
      setPendingName(name);
    },
    remove: (id: number) => setItems(current => current.filter(item => item.id !== id)),
    // 냉장고 칸·상품 촬영은 개수를 믿기 어려우니 수량은 1개로 두고, 영수증처럼 사전에 없는 이름만 오류로 표시한다.
    showDetected: (names: (string | PhotoRecognitionItem)[]) => {
      setSource('camera');
      start(names.map((value, id) => {
        if (typeof value !== 'string') return {...value,id,quantity:1,image:categoryImage(value.category),error:!matchIngredient(value.name),corrected:false};
        const name = value;
        const category = classifyIngredient(name);
        return { id, name, quantity: 1, category, image: categoryImage(category), error: !matchIngredient(name), corrected: false };
      }), now());
    },
    showPhoto: (results:PhotoRecognitionItem[]) => {setSource('camera');start(results.map((item,id)=>({...item,id,quantity:1,image:categoryImage(item.category),error:!matchIngredient(item.name),corrected:false})),now());},
    showReceipt: (result: ReceiptResult) => {
      const at = now();
      setSource('receipt');
      start(result.items.map((item, id) => {
        const category = classifyIngredient(item.name);
        // 사전에 없는 이름은 오인식일 수 있으니 확인하도록 표시한다.
        return { id, name: item.name, quantity: item.quantity, category, image: categoryImage(category), error: item.suspicious || !matchIngredient(item.name), corrected: false };
      }), { date: result.date ?? at.date, time: result.time ?? at.time });
    },
  };
}
