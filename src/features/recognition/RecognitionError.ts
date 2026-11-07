// 촬영은 됐지만 인식 단계에서 실패한 경우. 카메라 화면 대신 인식 실패 화면으로 보낸다.
// 로그인 필요·카메라 권한·촬영 실패 같은 오류는 일반 Error로 남겨 카메라 화면에서 안내한다.
export type RecognitionSource = 'receipt' | 'fridge' | 'product';
export type RecognitionFailureKind = 'empty' | 'failed' | 'limit';

export class RecognitionError extends Error {
  constructor(public kind: RecognitionFailureKind, public source: RecognitionSource, message: string) {
    super(message);
    this.name = 'RecognitionError';
  }
}

/** 서버 응답 상태로 실패 종류를 고른다. 429는 앱 일일 한도나 공급자 한도라 다시 촬영해도 실패한다. */
export function failureKind(status: number): RecognitionFailureKind {
  return status === 429 ? 'limit' : 'failed';
}

/** 로그인이 필요한 오류는 인식 실패가 아니라 카메라 화면에서 그대로 안내한다. */
export function isLoginError(error: unknown) {
  return error instanceof Error && error.message.includes('로그인');
}
