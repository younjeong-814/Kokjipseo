import { useEffect, useRef, useState } from 'react';
import { useAppStorage } from './features/cloud/StorageContext';
import { useSavedRecipes } from './features/cloud/SavedRecipes';
import { BottomNavigation } from './components/BottomNavigation';
import { Snackbar } from './components/Snackbar';

import { TopHeader } from './components/TopHeader';
import { HomePage } from './features/home/HomePage';
import { RegistrationPage } from './features/registration/RegistrationPage';
import { FridgeGuidePage, ProductGuidePage } from './features/registration/FridgeGuidePage';
import { ManualEntryPage } from './features/registration/ManualEntryPage';
import { RecipeEmptyPage } from './features/recipe/RecipeEmptyPage';
import { RecipeResultsPage } from './features/recipe/RecipeResultsPage';
import { RecipeDetailPage } from './features/recipe/RecipeDetailPage';
import { toRecipeDetail, toRecipeSummary } from './features/recipe/apiPresentation';
import type { Recipe } from './features/recipe/types';
import { RecipePage } from './features/recipe/RecipePage';
import { RecipeResults } from './features/recipe/RecipeResults';
import { matchIngredient } from './features/ingredients/classify';
import { RecipeNoUrgentPage } from './features/recipe/RecipeNoUrgentPage';
import { selectRecipeIngredients } from './features/recipe/selectRecipeIngredients';
import { FridgePage } from './features/fridge/FridgePage';
import { FridgeFoodPage } from './features/fridge/FridgeFoodPage';
import { FridgeSearchEmpty, FridgeSearchGuide, FridgeSearchPage } from './features/fridge/FridgeSearchPage';
import { parseQuery, searchIngredients, type SearchQuery } from './features/fridge/search';
import { ReceiptCameraPage } from './features/receipt/ReceiptCameraPage';
import { ReceiptGuidePage } from './features/receipt/ReceiptGuidePage';
import { RecognitionResultPage } from './features/recognition/RecognitionResultPage';
import { useRecognition } from './features/recognition/useRecognition';
import { IngredientDetailPage } from './features/ingredients/IngredientDetailPage';
import { recognizeReceipt } from './features/receipt/ocr';
import { recognizeIngredients } from './features/recognition/recognize';
import { defaultStorage } from './features/ingredients/expiry';
import { toDateKey } from './lib/date';
import { StoredIngredientsPage } from './features/ingredients/StoredIngredientsPage';
import { useIngredients } from './features/ingredients/useIngredients';
import type { Ingredient, RemovedIngredient } from './features/ingredients/repository';
import { isFood } from './features/ingredients/expiry';
import { useDashboardReports } from './features/mypage/useDashboardReports';
import type { ReportPeriod } from './features/mypage/report';

import { MyPage } from './features/mypage/MyPage';
import { SettingsPage } from './features/mypage/SettingsPage';
import { WeeklyReportPage } from './features/report/WeeklyReportPage';
import { buildWeeklyReport, loadHistory } from './features/report/weeklyReport';
import { FridgeNotifications } from './features/notifications/FridgeNotifications';
import { additionalConnections, isScreenId, screens, type ScreenId } from './prototype/flow';
function readScreen(): ScreenId {
  const id = window.location.hash.slice(1).split('?')[0];
  return isScreenId(id) ? id : 'home';
}
const readDetailId = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('item');
export function App() {
  const storage=useAppStorage();
  const savedRecipes=useSavedRecipes();
  const [screen, setScreen] = useState(readScreen);
  const [myPagePeriod, setMyPagePeriod] = useState<ReportPeriod>('주간');
  const [managedPeriod, setManagedPeriod] = useState<ReportPeriod>('주간');
  const [searchOrigin, setSearchOrigin] = useState<'fridge' | 'fridge-food' | 'fridge-registered'>('fridge');
  const [searchQuery, setSearchQuery] = useState<SearchQuery>({ type: 'idle' });
  // 입력창 글자. 검색 결과 → 상세 → 뒤로 가기로 돌아왔을 때 같은 검색어를 다시 채운다.
  const [searchText, setSearchText] = useState('');
  const [captureGuide, setCaptureGuide] = useState<ScreenId>('guide-receipt');
  const [showRegistrationToast, setShowRegistrationToast] = useState(false);
  const [listDeletion, setListDeletion] = useState<{ storage: typeof storage; message: string; removed?: RemovedIngredient }>();
  const ingredients = useIngredients();
  const dashboard = useDashboardReports(ingredients.items, ingredients.error);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | undefined>();
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [detailId, setDetailId] = useState(readDetailId);
  const [detailOrigin, setDetailOrigin] = useState<'home' | 'fridge' | 'fridge-registered' | 'fridge-food' | 'fridge-search'>('fridge-registered');
  const [editingFromDetail, setEditingFromDetail] = useState(false);
  const [recognitionError, setRecognitionError] = useState('');
  // 레시피 화면에서 고른 재료. 추천 결과 화면과 '다른 임박 재료 선택'으로 돌아올 때 유지한다.
  const [openedRecipe, setOpenedRecipe] = useState<Recipe | null>(null);
  const [recipeSelection, setRecipeSelection] = useState<string[] | undefined>();
  const registering = useRef(false);
  const recognition = useRecognition();
  useEffect(()=>{ const open=(event:Event)=>{setOpenedRecipe((event as CustomEvent<Recipe>).detail);window.location.hash='recipe-detail?recipe='+encodeURIComponent((event as CustomEvent<Recipe>).detail.id);};window.addEventListener('kokjipseo:open-saved-recipe',open);return()=>window.removeEventListener('kokjipseo:open-saved-recipe',open);},[]);
  useEffect(() => {
    const onHashChange = () => { const nextScreen = readScreen(); setScreen(nextScreen); setDetailId(readDetailId()); setListDeletion(undefined); if (nextScreen !== 'fridge-registered' && nextScreen !== 'fridge-food') setShowRegistrationToast(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const deleteFromList = (id: string) => {
    try {
      const removed = ingredients.removeFromList(id);
      if (!removed) return;
      setShowRegistrationToast(false);
      setListDeletion({ storage, removed, message: '목록에서 삭제되었어요.' });
    } catch {
      setShowRegistrationToast(false);
      setListDeletion({ storage, message: '삭제하지 못했어요. 다시 시도해 주세요.' });
    }
  };
  const undoListDeletion = () => {
    if (listDeletion?.storage !== storage || !listDeletion.removed) return;
    try {
      ingredients.restoreToList(listDeletion.removed);
      setListDeletion(undefined);
    } catch {
      setListDeletion({ storage, message: '복원하지 못했어요. 저장 설정을 확인해 주세요.' });
    }
  };
  const navigate = (destination: ScreenId) => {
    if (destination !== 'manual-entry') setEditingIngredient(undefined);
    if (destination === 'fridge-search' && (screen === 'fridge' || screen === 'fridge-food' || screen === 'fridge-registered')) setSearchOrigin(screen);
    // 냉장고 탭에서 새로 열 때만 비운다. 상세에서 돌아올 때는 직전 검색을 그대로 보여 준다.
    if (destination === 'fridge-search' && screen !== 'ingredient-detail') { setSearchQuery({ type: 'idle' }); setSearchText(''); }
    if (destination === 'camera' && (screen === 'guide-fridge' || screen === 'guide-product' || screen === 'guide-receipt')) setCaptureGuide(screen);
    setShowRegistrationToast((screen === 'recognition-result' || screen === 'manual-entry') && (destination === 'fridge-registered' || destination === 'fridge-food'));
    window.location.hash = destination;
  };
  const isSearching = screen === 'fridge-search';
  const displayScreen = isSearching ? searchOrigin : screen;
  // 검색은 식재료·음식 탭을 가리지 않고 냉장고 전체를 대상으로 한다.
  const searchMatches = isSearching && (searchQuery.type === 'text' || searchQuery.type === 'choseong') ? searchIngredients(ingredients.items, searchQuery) : null;
  const ingredientItems = ingredients.items.filter(item => !isFood(item));
  const foodItems = ingredients.items.filter(isFood);
  const hasRecipeSelection = ingredientItems.some(item => recipeSelection?.includes(item.id));
  // 새로고침 등으로 선택한 재료가 없으면 재료 선택 화면으로 돌아간다.
  useEffect(() => { if ((screen === 'recipe-no-result' || screen === 'recipe-results') && !hasRecipeSelection) window.location.replace('#recipe'); }, [screen, hasRecipeSelection]);
  const info = screens[displayScreen];
  // 영수증 촬영은 OCR, 냉장고 칸·상품 촬영은 Gemini 식재료 인식을 거친다.
  // 인식에 실패하면 오류를 던져 카메라 화면에 안내하고, 결과 화면으로 넘어가지 않는다.
  const onCapture = async (image: string) => {
    registering.current = false;
    setRecognitionError('');
    if (captureGuide === 'guide-receipt') recognition.showReceipt(await recognizeReceipt(image));
    else recognition.showDetected(await recognizeIngredients(image, captureGuide === 'guide-product' ? 'product' : 'fridge'));
    navigate('recognition-result');
  };
  const openDetail = (item: Ingredient) => { window.location.hash = `ingredient-detail?item=${encodeURIComponent(item.id)}`; };
  const registerRecognized = () => {
    if (registering.current) return;
    // 보관 시작일은 결과 화면의 날짜(영수증 구매일 또는 촬영일)다. 미래 날짜면 등록일을 쓴다.
    const storageStartedOn = recognition.date <= toDateKey(new Date()) ? recognition.date : undefined;
    const drafts = recognition.items.map(item => ({ name: item.name, category: item.category, storage: defaultStorage(item.name), quantity: item.quantity, unit: '개', date: '', storageStartedOn, source: captureGuide === 'guide-receipt' ? 'ocr' as const : 'camera' as const }));
    if (!drafts.length) { setRecognitionError('등록할 식재료가 없어요. 다시 촬영해 주세요.'); return; }
    // 국·찌개·밀키트 같은 음식은 냉장고 음식 탭에 들어간다. 모두 음식이면 음식 탭을 연다.
    const foods = drafts.filter(isFood).length;
    const ingredientsCount = drafts.length - foods;
    const message = [ingredientsCount && `식재료 ${ingredientsCount}개`, foods && `음식 ${foods}개`].filter(Boolean).join(', ');
    try { registering.current = true; ingredients.saveRecognized(drafts); setRegistrationMessage(`${message}를 등록했어요`); navigate(ingredientsCount ? 'fridge-registered' : 'fridge-food'); }
    catch (failure) { registering.current = false; setRecognitionError(failure instanceof Error ? failure.message : '저장하지 못했어요.'); }
  };
  const renderScreen = () => {
  if (screen === 'recipe-detail') {
    const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('recipe');
    const detailRecipe = openedRecipe?.id===id ? openedRecipe : savedRecipes.items.find(r=>r.id===id);
    return <div className="app-shell">{detailRecipe ? <><RecipeDetailPage recipe={toRecipeDetail(detailRecipe)} onBack={() => navigate('recipe-results')} /><p className="recipe-source">출처: 농림수산식품교육문화정보원</p></> : <main className="ingredient-not-found"><p>레시피 목록에서 다시 선택해 주세요.</p><button onClick={() => navigate('recipe')}>재료 선택으로 가기</button></main>}</div>;
  }
  if (screen === 'recipe-results') {
    const selected = (recipeSelection ?? []).flatMap(id => ingredientItems.filter(item => item.id === id));
    if (!selected.length) return null;
    const names = [...new Set(selected.map(item => matchIngredient(item.name)?.keyword ?? item.name.trim()))];
    return <div className="app-shell"><RecipeResults key={JSON.stringify(names)} ingredients={names} selectionContext={{ selected, onBack: () => navigate('recipe'), onReselect: () => navigate('recipe') }} renderResults={(data, pagination) => <><RecipeResultsPage total={data.total} recipes={data.recipes.map(recipe => toRecipeSummary(recipe, names))} selectedIngredients={selected.map(item => item.name)} onBack={() => navigate('recipe')} onOpen={id => { const recipe = data.recipes.find(item => item.id === id); if (recipe) { setOpenedRecipe(recipe); window.location.hash = `recipe-detail?recipe=${encodeURIComponent(id)}`; } }} footer={<footer className="recipe-results-footer">{pagination}<p className="recipe-source">출처: 농림수산식품교육문화정보원</p></footer>} /></>} /><BottomNavigation screen={screen} navigate={navigate} /></div>;
  }
  if (screen === 'settings') {
    return <div className="app-shell screen-settings"><SettingsPage onBack={() => navigate('mypage')} /></div>;
  }
  if (screen === 'weekly-report') {
    return <div className="app-shell"><WeeklyReportPage period={managedPeriod} report={buildWeeklyReport(ingredients.items, loadHistory(storage), new Date(), managedPeriod)} onBack={() => navigate('mypage')} /><BottomNavigation screen={screen} navigate={navigate} /></div>;
  }
  if (screen === 'ingredient-detail') {
    const item = ingredients.items.find(value => value.id === detailId);
    return <div className="app-shell">{item ? <IngredientDetailPage key={item.id} item={item} onBack={() => navigate(detailOrigin)} onEdit={patch => ingredients.updateInfo(item.id, patch)} onSave={patch => ingredients.updateDetails(item.id, patch)} onCondition={status => ingredients.recordCondition(item.id, status)} onDiscard={() => { ingredients.remove(item.id); navigate(detailOrigin); }} onConsume={() => { ingredients.consume(item.id); navigate(detailOrigin); }} /> : <main className="ingredient-not-found"><p role="alert">{ingredients.error || '식재료를 찾을 수 없어요. 삭제된 항목인지 확인해 주세요.'}</p><button onClick={() => navigate('fridge')}>냉장고로 돌아가기</button></main>}</div>;
  }
  if (screen === 'recipe-no-result') {
    // 재료 선택 화면과 같은 순서(임박순)로 보여준다.
    const selected = (recipeSelection ?? []).flatMap(id => ingredientItems.filter(item => item.id === id));
    if (!selected.length) return null;
    const names = [...new Set(selected.map(item => matchIngredient(item.name)?.keyword ?? item.name.trim()))];
    return <div className="app-shell"><RecipeResults key={JSON.stringify(names)} ingredients={names} selectionContext={{ selected, onBack: () => navigate('recipe'), onReselect: () => navigate('recipe') }} /></div>;
  }
  // 식재료는 있지만 D-3 이내·기한경과 재료가 없으면 탭바 없는 안내 화면을 보여준다. 식재료가 아예 없으면 아래 RecipeEmptyPage.
  if (screen === 'recipe' && ingredientItems.length && !selectRecipeIngredients(ingredientItems, new Date()).length) {
    return <div className="app-shell"><RecipeNoUrgentPage onBack={() => navigate('home')} onOpenFridge={() => navigate('fridge')} /></div>;
  }
  if (screen === 'manual-entry') {
    return <div className="app-shell"><ManualEntryPage key={editingIngredient?.id ?? 'new'} navigate={navigate} initial={editingIngredient} onCancel={editingFromDetail && editingIngredient ? () => openDetail(editingIngredient) : undefined} onSave={(draft, id) => {
      ingredients.save(draft, id);
      const noun = isFood(draft) ? '음식' : '식재료';
      setRegistrationMessage(id ? `${noun}${noun === '음식' ? '을' : '를'} 수정했어요` : `${noun} 1개를 등록했어요`);
      if (id && editingFromDetail && editingIngredient) openDetail(editingIngredient);
      else navigate(isFood(draft) ? 'fridge-food' : 'fridge-registered');
    }} /></div>;
  }
  if (screen === 'guide-fridge' || screen === 'guide-product' || screen === 'guide-receipt' || screen === 'camera' || screen === 'recognition-result') {
    return (
      <div className="app-shell screen-receipt">

        {screen === 'guide-fridge' && <FridgeGuidePage navigate={navigate} />}
        {screen === 'guide-product' && <ProductGuidePage navigate={navigate} />}
        {screen === 'guide-receipt' && <ReceiptGuidePage navigate={navigate} />}
        {screen === 'camera' && <ReceiptCameraPage navigate={navigate} backDestination={captureGuide} onCapture={onCapture} />}
        {recognitionError && <p className="ingredient-error" role="alert">{recognitionError}</p>}
        {screen === 'recognition-result' && <RecognitionResultPage navigate={navigate} recognition={recognition} onRegister={registerRecognized} />}
      </div>
    );
  }
  return (
    <div className={`app-shell screen-${info.menu}${isSearching ? ' fridge-search-open' : ''}`} onClick={event => {
      // 검색 결과 줄은 스와이프용 포인터 캡처 때문에 클릭 대상이 버튼이 아닌 줄 div가 되므로, 목록 안 클릭은 검색 닫기에서 뺀다.
      if (isSearching && event.target instanceof Element && !event.target.closest('button, input, select, textarea, form, a, .stored-ingredients')) navigate(searchOrigin);
    }}>

      {isSearching ? <FridgeSearchPage navigate={navigate} initialQuery={searchText} onClose={() => navigate(searchOrigin)} onSearch={raw => { setSearchText(raw); const parsed = parseQuery(raw); if (parsed.type !== 'hold') setSearchQuery(parsed); }} /> : <TopHeader title={info.title} onSettings={screen === 'mypage' ? () => navigate('settings') : undefined} search={screen === 'fridge' || screen === 'fridge-food' || screen === 'fridge-registered' ? additionalConnections.search.destination : undefined} navigate={navigate} />}
      {ingredients.error && <p className="ingredient-error" role="alert">{ingredients.error}</p>}
      {screen === 'home' && <HomePage navigate={navigate} items={ingredients.items} onOpen={item => { setDetailOrigin('home'); openDetail(item); }} />}
      {searchMatches && 'raw' in searchQuery && (searchMatches.size ? <StoredIngredientsPage key="search" navigate={navigate} items={ingredients.items} matches={searchMatches} onOpen={item => { setDetailOrigin('fridge-search'); openDetail(item); }} onDelete={deleteFromList} /> : <FridgeSearchEmpty query={searchQuery.raw} onRegister={() => navigate('registration')} />)}
      {isSearching && !searchMatches && <FridgeSearchGuide />}
      {!isSearching && (displayScreen === 'fridge' || displayScreen === 'fridge-registered') && (ingredientItems.length ? <StoredIngredientsPage key={displayScreen} navigate={navigate} items={ingredientItems} registered={displayScreen === 'fridge-registered'} onOpen={item => { setDetailOrigin(displayScreen === 'fridge-registered' ? 'fridge-registered' : 'fridge'); openDetail(item); }} onDelete={deleteFromList} /> : <FridgePage navigate={navigate} />)}
      {!isSearching && displayScreen === 'fridge-food' && (foodItems.length ? <StoredIngredientsPage key="food" food navigate={navigate} items={foodItems} onOpen={item => { setDetailOrigin('fridge-food'); openDetail(item); }} onDelete={deleteFromList} /> : <FridgeFoodPage navigate={navigate} />)}
      {screen === 'registration' && <RegistrationPage navigate={navigate} />}
      {screen === 'mypage' && <MyPage selectedPeriod={myPagePeriod} onPeriodChange={setMyPagePeriod} navigate={navigate} onOpenManaged={period => { setManagedPeriod(period); navigate('weekly-report'); }} report={buildWeeklyReport(ingredients.items, loadHistory(storage))} registeredCount={ingredientItems.length} reports={dashboard.reports} error={dashboard.error} />}
      {screen === 'recipe' && (ingredientItems.length ? <RecipePage items={ingredientItems} initialSelected={recipeSelection} onRecommend={selected => { setRecipeSelection(selected.map(item => item.id)); navigate('recipe-results'); }} /> : <RecipeEmptyPage navigate={navigate} />)}
      <BottomNavigation screen={displayScreen} navigate={navigate} />
      {listDeletion?.storage === storage && <Snackbar key={listDeletion.removed?.item.id ?? listDeletion.message} message={listDeletion.message} onDismiss={() => setListDeletion(undefined)} figmaNode={listDeletion.removed ? '6792:10117' : undefined} action={listDeletion.removed ? { label: '되돌리기', onClick: undoListDeletion } : undefined} />}
      <FridgeNotifications screen={screen} items={ingredients.items} registrationActive={showRegistrationToast} registrationMessage={registrationMessage} onDismissRegistration={() => setShowRegistrationToast(false)} />
    </div>
  );
  };
  return <>{renderScreen()}<FridgeNotifications screen={screen} items={ingredients.items} registrationActive={showRegistrationToast} registrationMessage={registrationMessage} onDismissRegistration={() => setShowRegistrationToast(false)} /></>;
}
