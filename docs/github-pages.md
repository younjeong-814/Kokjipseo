# GitHub Pages 자동 배포

1. 이 변경사항을 PR로 master에 머지합니다.
2. 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 선택합니다.
3. master push마다 Actions의 Deploy GitHub Pages가 의존성 설치, 테스트, 빌드, 배포를 순서대로 실행합니다. Actions → Deploy GitHub Pages → Run workflow에서도 master를 선택해 재실행할 수 있습니다.
4. 배포 성공 후 GitHub Pages 환경에 표시되는 URL로 접속합니다. 기본 주소는 https://younjeong-814.github.io/Kokjipseo/ 입니다.

Pages가 제공하는 base_path를 Vite의 --base 옵션으로 전달하므로 저장소 하위 경로에서도 JS/CSS와 asset() 이미지 경로가 연결됩니다. 기존 해시 라우팅을 유지합니다. 로컬 vite.config.ts와 개발 서버는 변경하지 않습니다. 배포 파일은 dist만 업로드합니다.

## 레시피·OCR 서버

GitHub Pages는 정적 호스팅이므로 Vite 개발 서버의 /api/recipes, /api/ocr 미들웨어를 실행하지 않습니다. 별도 HTTPS 서버/서버리스 배포 후 Settings → Secrets and variables → Actions → Variables에 아래 공개 URL을 등록하고 재배포하세요.

- VITE_RECIPE_ENDPOINT: 레시피 서버의 전체 엔드포인트 URL
- VITE_OCR_ENDPOINT: OCR 서버의 전체 엔드포인트 URL
- VITE_RECOGNIZE_ENDPOINT: 냉장고 칸·상품 촬영 식재료 인식(Gemini) 서버의 전체 엔드포인트 URL

서버는 Pages 출처에 대해 CORS를 허용해야 합니다. 위 변수에 키를 넣지 마세요. FOOD_SAFETY_API_KEY, FOOD_API_KEY, GOOGLE_VISION_API_KEY, GEMINI_API_KEY(필요하면 GEMINI_MODEL)는 별도 서버의 비밀 환경 변수로만 설정합니다. 로컬 .env.local은 Git 제외 상태를 유지하며 워크플로에서 읽지 않습니다. 서버 URL 미설정 상태에서는 화면과 브라우저 localStorage 기능을 확인할 수 있으며 실제 레시피 검색·OCR은 사용할 수 없습니다.

기존 localhost 저장 데이터는 Pages로 자동 이전되지 않으며 접속 브라우저/출처별로 별도 저장됩니다.

공식 문서: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
