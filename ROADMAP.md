# QueryX Roadmap

QueryX는 “The VS Code of Databases”를 목표로 하는 오픈소스 로컬 우선 Database IDE입니다. 이 문서는 제품 방향과 구현 순서를 공유하기 위한 실행 로드맵입니다.

## 현재 상태

### Prototype — complete

- VS Code 스타일의 Dark IDE shell
- Explorer, SQL editor, Result grid, Inspector 레이아웃
- 쿼리 실행·포맷 affordance와 단축키 안내
- 결과 필터링, 정렬, JSON 보기, 페이지네이션 UI
- 스키마 트리 collapse/expand와 테이블별 컬럼 Inspector
- local-first 상태 메시지와 기본 제품 메타데이터

루트의 dependency-free preview는 빠른 UI 확인용으로 유지하고, 실제 개발 진입점은 `apps/desktop` React/Vite 앱입니다. Tauri/Rust 런타임과 실제 DB 연결은 다음 단계의 구현 대상입니다.

### Foundation — in progress

- [x] pnpm workspace와 `apps/desktop` React/TypeScript/Vite 앱
- [x] Zustand 기반 query/editor/result UI 상태
- [x] shared `DatabaseDriver`와 `QueryResult` 타입 계약
- [x] deterministic `InMemoryDriver`로 연결·metadata·query 실행 workflow
- [x] Safe Mode safety analyzer와 사용자 확인 모달 preview
- [x] localStorage 기반 query history preview
- [x] 실제 `apps/desktop` production build 검증
- [x] Tauri 2와 Rust command bridge
- [x] SQLx 기반 실제 SQLite connection과 native integration tests
- [x] SQLx 기반 실제 PostgreSQL connection과 환경 선택형 integration test
- [x] 세션 전용 credential 입력을 제공하는 connection dialog
- [x] 임의 query column을 렌더링하는 dynamic result grid
- [x] Monaco 기반 SQL editor, 독립 undo 모델을 가진 multi-tab, metadata autocomplete

## v0.1 — Local database workflow

목표: 로컬 환경에서 안전하게 연결하고 SQL을 실행하는 첫 usable release.

- [x] React/TypeScript/Vite workspace 구성
- [x] Tauri 2 desktop shell
- [x] Rust `DatabaseDriver` 공통 인터페이스와 contract test 정의
- [x] SQLite driver 구현 및 연결 테스트
- [x] PostgreSQL driver 구현 및 연결 테스트
- [ ] MySQL driver 구현 및 연결 테스트
- [x] 공통 `QueryResult` 모델(`columns`, `rows`, `executionTime`, `affectedRows`, `warnings`, `error`)
- [ ] Explorer metadata API(`listSchemas`, `listTables`, `listColumns`, `listIndexes`, `listViews`)
- [x] Monaco 기반 SQL editor와 multi-tab 상태
- [ ] AG Grid Community 기반 결과 그리드
- [ ] CSV export
- [ ] Query history와 favorites의 SQLite local storage
- [ ] OS keychain 연동; 비밀번호를 SQLite나 workspace 파일에 저장하지 않음
- [x] Ctrl/Cmd+Enter 전체/선택 SQL 실행과 오류 상태 처리
- [ ] 실행 중인 native query 취소

완료 기준:

1. 사용자가 SQLite 또는 PostgreSQL에 연결하고 쿼리를 실행할 수 있습니다.
2. 드라이버 종류를 몰라도 동일한 결과 모델로 결과를 표시합니다.
3. 연결 정보·쿼리·결과가 QueryX 서버나 외부 서비스로 전송되지 않습니다.
4. 대표적인 실패 흐름이 UI와 문서에 함께 설명되어 있습니다.

## v0.2 — Safe editing workflow

목표: 운영 데이터에 대한 실수 방지와 생산성 기능을 갖춥니다.

현재 Safe Mode와 history는 브라우저 preview 단계까지 구현되어 있습니다. 실제 release 완료로 표시하려면 Rust parser/transaction과 SQLite workspace storage가 필요합니다.

- [ ] SQL autocomplete, snippets, formatting
- [ ] Explain plan panel
- [ ] Safe Mode의 `WHERE` 없는 UPDATE/DELETE 감지
- [ ] 예상 affected rows와 transaction 실행 옵션
- [ ] transaction begin/commit/rollback UI
- [ ] table row view/edit와 변경사항 diff
- [ ] workspace 디렉터리(`queries/`, `favorite/`, `history/`, `settings.json`)
- [ ] Ctrl/Cmd+P Quick Open 및 Command Palette
- [ ] query history 검색·재실행·즐겨찾기

완료 기준: 위험한 변경 쿼리가 명시적인 확인 없이 실행되지 않고, 모든 변경 작업은 되돌릴 수 있는 실행 경로를 제공합니다.

## v0.3 — Extensibility

목표: 외부 개발자가 QueryX를 확장할 수 있는 안정적인 경계를 제공합니다.

- [ ] SQL Server driver
- [ ] Oracle driver
- [ ] `plugin.json` manifest schema
- [ ] `activate()` / `deactivate()` lifecycle
- [ ] commands, menus, panels contribution points
- [ ] Plugin SDK 문서와 샘플 plugin
- [ ] Theme token과 Theme SDK 초안
- [ ] driver capability discovery 및 compatibility checks

완료 기준: 샘플 export plugin을 별도 패키지로 설치하고, core UI 변경 없이 command와 panel을 추가할 수 있습니다.

## v0.5 — Advanced database workflows

- [ ] ER diagram plugin
- [ ] Schema compare
- [ ] Data compare
- [ ] MariaDB driver
- [ ] 대용량 결과 스트리밍과 virtual scrolling
- [ ] Markdown, JSON, Excel, SQL export
- [ ] query performance diagnostics

## v1.0 — Stable ecosystem

- [ ] Stable release와 migration policy
- [ ] Plugin marketplace proposal
- [ ] Community driver certification guide
- [ ] Crash-safe local storage migrations
- [ ] Accessibility and keyboard navigation audit
- [ ] Security review와 threat model 공개
- [ ] Release notes, upgrade guide, support policy

## Cross-cutting quality gates

각 milestone은 기능 구현만으로 완료하지 않습니다.

- TypeScript strict mode와 Biome clean
- Rust `cargo fmt`, `cargo clippy`, unit/integration tests
- Driver contract test suite
- 로컬 저장 데이터 및 keychain 경계 테스트
- 위험 쿼리 안전성 테스트
- 핵심 workflow의 keyboard/accessibility 검증
- 사용자-facing 문서와 changelog 업데이트

## 의사결정 원칙

우선순위가 충돌할 때는 다음 순서를 따릅니다.

1. 사용자 데이터가 기기를 떠나지 않도록 합니다.
2. 파괴적인 작업은 명시적으로 확인 가능하고 복구 가능해야 합니다.
3. DB별 차이는 driver 내부에 두고 UI에는 공통 모델만 노출합니다.
4. 빠른 기본 workflow를 유지하면서 확장 포인트를 작게 명확하게 설계합니다.
5. 기능보다 관찰 가능한 품질 기준과 문서화 가능성을 먼저 확보합니다.
