# QueryX Documentation Plan

## 목적

QueryX 문서는 사용자가 안전하게 데이터를 다루도록 돕고, 기여자가 제품의 경계를 빠르게 이해하도록 만드는 것을 목표로 합니다. 모든 문서는 “local first”, “safe by default”, “driver-neutral UI” 원칙을 공유해야 합니다.

## 문서 정보 구조

### 1. 사용자 문서

대상: QueryX를 처음 설치하고 실제 DB를 다루는 개발자.

- `docs/getting-started.md` — 설치, 첫 연결, 첫 query 실행
- `docs/connections.md` — 연결 생성·복제·테스트·삭제와 keychain 동작
- `docs/sql-editor.md` — tabs, autocomplete, shortcuts, format, explain
- `docs/results.md` — grid, filter, sort, copy, JSON view, pagination
- `docs/metadata-explorer.md` — schemas, tables, views, columns, indexes, foreign keys, routines
- `docs/routine-inspector.md` — overload identity, functions/procedures/aggregates/window functions, database-rendered DDL, safety boundary
- `docs/trigger-inspector.md` — trigger activation, ownership, database-rendered DDL
- `docs/event-trigger-inspector.md` — database-wide DDL events, function dependencies, reconstructed DDL
- `docs/dependency-inspector.md` — direct dependency direction, navigation, identity, driver limits
- `docs/export.md` — CSV/JSON/Excel/SQL export와 대용량 데이터 주의사항
- `docs/safe-mode.md` — 위험 쿼리 감지, transaction, estimated affected rows
- `docs/workspaces.md` — `queries/`, favorites, history, settings 관리
- `docs/troubleshooting.md` — 연결, 권한, timeout, encoding, driver 오류

### 2. 개발자 문서

대상: QueryX core·driver·plugin을 수정하는 기여자.

- `docs/architecture.md` — Tauri, React, Rust, storage 경계
- `docs/driver-api.md` — `DatabaseDriver`, metadata API, capabilities
- `docs/result-model.md` — 공통 result/error/warning 계약
- `docs/plugin-sdk.md` — manifest, lifecycle, commands, menus, panels
- `docs/storage-and-security.md` — local storage, OS keychain, telemetry policy
- `docs/testing.md` — driver contract, UI workflow, safety test 전략
- `docs/release-process.md` — versioning, migrations, changelog, rollback

### 3. 프로젝트 문서

- `README.md` — 프로젝트 소개, 원칙, 빠른 실행, 현재 상태
- `ROADMAP.md` — milestone과 완료 기준
- `CONTRIBUTING.md` — 개발 환경과 PR 규칙
- `CODE_OF_CONDUCT.md` — 커뮤니티 행동 기준
- `SECURITY.md` — 취약점 신고와 보안 경계
- `CHANGELOG.md` — 사용자에게 의미 있는 변경 기록
- `docs/decisions/` — 중요한 architecture decision record(ADR)

## 작성 우선순위

### Phase A — prototype handoff (complete)

현재 프로토타입을 다음 구현자가 이어받을 수 있게 합니다.

1. README에 현재 prototype 범위와 실제 미구현 범위를 명시합니다.
2. `ROADMAP.md`에 v0.1의 완료 기준을 고정합니다.
3. architecture ADR을 작성해 driver interface, local storage, safe mode 결정을 기록합니다.

### Phase B — v0.1 launch docs (in progress)

실제 SQLite/PostgreSQL 연결이 들어오는 시점에 사용자 문서를 추가합니다.

1. [x] Getting Started
2. [x] Connections
3. [x] SQL Editor
4. [x] Results and CSV Export
5. [x] Troubleshooting
6. [x] Security policy and local-first boundaries
7. [ ] Native packaging, signing, and update guide
8. [ ] Workspace persistence and keychain guide when those features land

### Phase C — extensibility docs

plugin SDK가 안정화되면 API reference와 샘플을 함께 배포합니다.

1. Plugin quickstart
2. Manifest schema
3. Contribution point reference
4. Driver implementation guide
5. Compatibility and versioning policy

## 문서 템플릿

모든 기능 문서는 아래 순서를 기본으로 합니다.

```md
# Feature name

## What it does
## Before you start
## Quick start
## Options and behavior
## Safety and privacy
## Troubleshooting
## Related
```

각 문서에는 최소 하나의 성공 경로와 하나의 실패/복구 경로가 있어야 합니다. 복사 가능한 명령어와 예시는 실제 지원 버전 기준으로 유지합니다.

## API 문서 규칙

- public interface와 타입은 TypeScript/Rust 선언에서 자동 생성 가능한 형태로 유지합니다.
- driver별 예외사항은 공통 API 설명과 분리해 driver 섹션에 둡니다.
- 예시는 비밀번호·토큰·실제 개인정보를 포함하지 않는 synthetic 데이터만 사용합니다.
- `error`, `warning`, `affectedRows`를 생략하지 않고 실제 호출자가 처리해야 하는 이유를 설명합니다.
- breaking change는 migration 예시와 함께 `CHANGELOG.md`에 기록합니다.

## 문서 품질 체크리스트

- [ ] 문서의 대상 독자와 성공 결과가 첫 화면에 보입니다.
- [ ] 제품 UI의 용어와 문서 용어가 일치합니다.
- [ ] 로컬 저장 위치와 외부 전송 여부를 명확히 설명합니다.
- [ ] destructive query와 rollback 경로를 설명합니다.
- [ ] 지원 버전과 driver capability 차이를 표시합니다.
- [ ] 코드 예시가 lint/test 기준을 통과합니다.
- [ ] 변경된 기능에는 changelog 항목이 있습니다.
- [ ] 링크가 깨지지 않고 새 문서가 README 또는 관련 문서에서 발견됩니다.

## 운영 방식

- 기능 PR에는 해당 사용자/개발자 문서 변경을 함께 포함합니다.
- milestone 종료 전 문서 담당자가 quickstart를 빈 환경에서 재실행합니다.
- release마다 문서의 지원 버전, known issues, migration 안내를 검토합니다.
- 큰 설계 변경은 구현 전에 `docs/decisions/ADR-XXXX-title.md`로 결정과 trade-off를 기록합니다.
- 문서에서 해결되지 않는 반복 질문은 FAQ 또는 troubleshooting에 승격합니다.
