# DT Sniper

참여자별 출발지와 이전 누적 상대 부담을 고려해 모임 장소를 추천하는 웹 서비스입니다. 대중교통 경로 API 예상시간을 사용하며 실제 이동시간을 측정하지 않습니다.

## 무료 서버 배포

[DEPLOYMENT.md](DEPLOYMENT.md)를 따라 Render Free + Supabase Free로 배포합니다. render.yaml은 Free 서비스이며 영구 디스크를 생성하지 않습니다. DB 연결은 서버 환경변수 DATABASE_URL로만 전달합니다. 비밀번호와 API 키를 GitHub에 올리지 마세요.

- Node.js 24 권장.
- 의존성 설치: `npm ci`
- 빌드: `npm run build`
- 실행: `npm start`
- 검증: `npm run build` 후 `npm test`
- 상태 확인: `/healthz`

DATABASE_URL이 있으면 PostgreSQL과 DB 사진 저장소를 사용하고, 없으면 기존 로컬 SQLite와 파일 저장소를 사용합니다. 무료 Render 설정은 REQUIRE_REMOTE_DB=true이므로 DB 연결 없이 임시 저장소로 실행하지 않습니다. 최초 DB 구조 생성과 공개 교통망 데이터 가져오기는 자동입니다. 기존 PC 기록은 자동 이관되지 않습니다.

## 분석 흐름

정류장·노선 DB → 중앙 범위 후보 탐색·사전 평가 → 선별 후보의 경로 API 예상시간 확인 → 누적 공정성/이동 효율/개인 부담 완화 대안 → 장소 확정 시 이동 기록 저장. 후보 수와 조회량은 모임 조건·공급자·설정에 따라 달라집니다. 조회한 후보 안의 비교이며 매번 누적 불균형이 감소한다고 보장하지 않습니다.

무료 서버는 미사용 시 절전될 수 있으므로 발표 직전에 접속·분석을 확인하세요. 모임과 사진은 외부 DB에 보관됩니다. 사진도 무료 DB 용량을 사용합니다.
