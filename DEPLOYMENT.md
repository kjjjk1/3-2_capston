# 무료 시연 서버: Render Free + Supabase Free

화면과 추천 알고리즘은 그대로입니다. DATABASE_URL이 있으면 외부 PostgreSQL에 모임·개인별 출발지·분석 결과·이동 기록·사진을 저장합니다. 공개 링크는 Render에서 발급합니다. 기존 유료 Blueprint 대신 이 묶음의 render.yaml(plan: free, disk 없음)을 사용하세요.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com/dashboard 에 로그인하고 Free 조직에 새 프로젝트를 만듭니다. DB 비밀번호를 따로 안전하게 보관합니다.
2. 프로젝트 상단 Connect → Session pooler를 선택합니다. 포트 5432 연결 문자열을 복사합니다. Direct 또는 Transaction pooler(6543) 대신 Session pooler를 사용합니다.
3. 문자열의 [YOUR-DATABASE-PASSWORD]를 실제 DB 비밀번호로 바꿉니다. 비밀번호의 특수문자는 URL 인코딩해야 합니다. 이 연결 문자열은 서버 비밀정보이므로 GitHub나 채팅에 붙이지 않습니다.
4. Database settings의 SSL 설정에서 서버 루트 인증서를 내려받습니다. PEM 파일을 메모장으로 열고 전체 내용을 Render의 DATABASE_SSL_CA 환경변수에 붙여넣습니다. 본 서버는 TLS 인증서 검증을 끄지 않습니다. 일반 신뢰 인증서로 바로 연결되는 환경에서는 이 변수가 필요하지 않을 수 있습니다.

## 2. GitHub 업로드

github-upload 폴더 **안의 내용 전체**를 기존 저장소의 루트에 업로드하고 같은 경로는 덮어씁니다. 반드시 package-lock.json, postgres-store.mjs, postgres/0001_initial.sql, Dockerfile, .dockerignore, render.yaml도 포함하세요. 압축 파일 자체나 바깥 폴더를 올리지 않습니다.

.env, 사용자 DB, 사진, node_modules, dist, backup-before-*는 올리지 않습니다. 웹 업로드는 .gitignore로 자동 제외되지 않습니다.

## 3. Render에 무료 배포

1. https://dashboard.render.com 에 로그인하고 New → Blueprint에서 GitHub 저장소를 연결합니다.
2. 서비스 plan이 **Free**, 디스크가 **없음**인지 확인합니다. 이미 유료 서비스를 만든 경우 YAML 업로드만으로 요금제 변경이 완료됐다고 가정하지 말고 관리 화면의 실제 요금제·디스크를 확인합니다.
3. 요청되는 DATABASE_URL에 Supabase의 Session pooler 연결 문자열을 입력합니다. 경로 API 키는 아직 없어도 배포할 수 있습니다. 키 등록 전 ON 분석은 차단되며 OFF를 직접 선택하면 자체 추정으로 시연할 수 있습니다.
4. Environment에서 DATABASE_SSL_CA에 위 인증서의 전체 PEM 텍스트를 추가합니다. ODsay를 사용하려면 ODSAY_API_KEY와 ODSAY_DAILY_LIMIT도 추가합니다. 장소 검색이 필요하면 KAKAO_LOCAL_REST_API_KEY도 추가합니다.
5. 배포 후 https://서비스명.onrender.com 에 접속합니다. PUBLIC_ORIGIN은 기본 Render 도메인에서는 자동 처리됩니다. 자체 도메인이면 PUBLIC_ORIGIN=https://자체도메인 을 지정합니다.
6. /healthz가 {"status":"ok"}인지 확인하고 휴대폰 두 대에서 참여·출발지 입력·분석·확정·기록 저장을 확인합니다.
7. Render 서버를 재시작한 뒤 같은 모임과 기록·사진이 남아 있는지 확인합니다.

## 저장 및 보호

- 첫 부팅에서 dt_sniper 전용 스키마와 테이블·인덱스를 생성하고 공개 교통망 JSON을 가져옵니다. 기존 노선 데이터는 덮어쓰지 않습니다. 테이블을 수동으로 만들 필요는 없습니다.
- 앱 테이블은 public 스키마에 만들지 않습니다. RLS를 켜고 anon/authenticated 역할의 접근을 허용하지 않습니다. Supabase의 API exposed schemas에 dt_sniper를 추가하지 마세요.
- 브라우저는 기존 DT Sniper 서버 API만 사용하며 DB 비밀번호나 Supabase 서비스 키를 받지 않습니다. 연결은 postgres 소유자 계정으로 서버에서만 수행합니다.
- 사진은 비공개 photo_objects 테이블의 바이트 데이터로 보관하고, 기존 서버의 사진 조회 권한을 그대로 거칩니다. Supabase Storage 버킷을 별도로 만들 필요는 없습니다. 사진도 DB 용량을 사용합니다.
- PC의 기존 SQLite·사진은 자동 이관하지 않습니다. 클라우드는 새 모임/기록으로 시작합니다.
- DATABASE_URL이 없으면 기존 로컬 SQLite 실행도 가능합니다. 무료 Render 설정은 REQUIRE_REMOTE_DB=true이므로 연결 설정이 빠지면 임시 SQLite로 조용히 대체하지 않고 시작을 중단합니다.
- 기본 앱 카카오 일일 상한은 200(UTC 날짜 기준)이며, 제공사 실제 잔여량과 별개입니다. 유료 API 설정은 변경하지 않습니다.

## 발표 전 확인

Render Free는 15분간 미사용 시 절전되고 다음 접속 때 시작 지연이 생길 수 있습니다. 발표 직전에 링크를 열고 전체 흐름을 한 번 확인하세요. Supabase Free의 저활동 일시중지·용량·사용량 제한도 확인합니다. 실제 API 조회에는 본인 키의 쿼터가 적용됩니다.

## 검증 범위

PostgreSQL 엔진(PGlite)에서 마이그레이션, 재실행, 트랜잭션 롤백, 사진 저장, 모임 참여, 경로 API 모의 응답 분석, 확정, 기록 삭제를 검사했습니다. 기존 로컬 서버 재시작 테스트도 수행합니다. 실제 Supabase 계정/네트워크/TLS 연결과 Render Docker 배포는 프로젝트 생성 후 확인해야 합니다. 검증 과정에서 실제 대중교통 API 호출은 하지 않습니다.

공식 안내: https://supabase.com/docs/guides/database/connecting-to-postgres / https://render.com/docs/free

## 경로 API ON/OFF

모임 관리의 경로 API 검증 설정에서 선택합니다.

- ON: Render Environment의 KAKAO_TRANSIT_REST_API_KEY 또는 ODSAY_API_KEY를 사용합니다. 선택한 공급자의 키가 없으면 오류를 안내하며 OFF나 다른 API로 자동 전환하지 않습니다.
- OFF: 저장된 버스·지하철 교통망과 속도·도보·대기시간 가정으로 후보별 시간을 추정합니다. 외부 경로 API 요청과 사용량 차감은 0회입니다. 지도·장소 검색·서버·Supabase 연결까지 끄는 설정은 아닙니다.
- 키는 시연 전날 Render → Environment → Add Environment Variable에서 등록하고 Save and deploy로 적용한 뒤 앱을 새로고침하면 됩니다. 클라이언트에 API 키를 입력하지 않습니다. 실제 API 사용은 앱에서 ON으로 분석할 때 발생합니다.
- OFF의 경로 상태는 estimated이며 verified로 표시하지 않습니다. API로 검증되지 않은 노선별 상세 경로를 만들어 보여주지 않습니다.
- 장소 확정 시 meeting_history.calculation_mode에 api/estimated를 저장합니다. 기존 기록은 api로 유지하고, 분석 임시 데이터가 정리돼도 출처 표시는 남습니다.
- 자체 추정 정기 기록도 같은 방의 다음 누적 부담 계산에 반영됩니다. 결과와 기록 화면에서 자체 추정 포함 여부를 표시합니다. 예행연습 기록을 실제 시연의 시작 부담에서 제외하려면 다른 모임방에서 연습하거나 해당 기록을 삭제하세요.
