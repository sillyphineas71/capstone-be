---
name: "speckit-plan"
description: "Execute the implementation planning workflow using the plan template to generate design artifacts."
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/plan.md"
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before planning)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_plan` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- For each executable hook, output the following based on its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Outline

1. **Setup**: Attempt to run `.specify/scripts/bash/setup-plan.sh --json` from repo root and parse JSON for `FEATURE_SPEC`, `IMPL_PLAN`, `SPECS_DIR`, `BRANCH`.

   **[WINDOWS / SCRIPT FALLBACK — QUAN TRỌNG]**: Nếu script không chạy được (môi trường Windows, không có bash, hoặc script lỗi), agent PHẢI tự resolve các path sau bằng cách đọc `.specify/feature.json`:
   - `FEATURE_DIR` = đường dẫn tuyệt đối đến `feature_directory` trong `.specify/feature.json`
   - `FEATURE_SPEC` = `{FEATURE_DIR}/spec.md`
   - `IMPL_PLAN`   = `{FEATURE_DIR}/plan.md`
   - `SPECS_DIR`   = `{FEATURE_DIR}`

   Không được dừng lại hay báo lỗi vì script không chạy. Tiếp tục workflow với các path đã resolve thủ công.

2. **Load context**: Đọc `FEATURE_SPEC` và `.specify/memory/constitution.md`.

   **[CONSTITUTION FALLBACK]**: Nếu `constitution.md` rỗng hoặc không tồn tại, agent KHÔNG ĐƯỢC bỏ qua Phase 0. Thay vào đó:
   - Ghi nhận: "Constitution chưa được thiết lập — bỏ qua Constitution Check gate."
   - Tiếp tục Phase 0 bằng cách tự phân tích `FEATURE_SPEC` để tìm unknowns (NEEDS CLARIFICATION, dependencies, integrations, tech stack decisions).
   - Nếu không có unknown nào từ spec → vẫn phải tạo `research.md` ghi lại codebase analysis và technology decisions (không được bỏ qua).

3. **Execute plan workflow**: Follow the structure in IMPL_PLAN template to:
   - Fill Technical Context (mark unknowns as "NEEDS CLARIFICATION")
   - Fill Constitution Check section from constitution (hoặc ghi "N/A — constitution chưa thiết lập" nếu rỗng)
   - Evaluate gates (ERROR if violations unjustified)
   - Phase 0: Generate `research.md` (resolve all NEEDS CLARIFICATION) — **BẮT BUỘC ngay cả khi constitution rỗng**
   - Phase 1: Generate `data-model.md`, `contracts/`, `quickstart.md` — **BẮT BUỘC tất cả 3 artifacts**
   - Phase 1: Update agent context by running the agent script (nếu có `<!-- SPECKIT START -->` marker trong `AGENTS.md`)
   - Re-evaluate Constitution Check post-design

4. **[ARTIFACT COMPLETENESS GATE — BẮT BUỘC TRƯỚC KHI BÁO CÁO]**

   Trước khi kết thúc, agent PHẢI tự kiểm tra tất cả các file sau đã tồn tại trong `SPECS_DIR`:

   ```
   SPECS_DIR/
   ├── plan.md          ← BẮT BUỘC
   ├── research.md      ← BẮT BUỘC (Phase 0 output)
   ├── data-model.md    ← BẮT BUỘC (Phase 1 output)
   ├── quickstart.md    ← BẮT BUỘC (Phase 1 output)
   └── contracts/       ← BẮT BUỘC nếu feature có external API/interface
       └── <name>-api.md
   ```

   Nếu bất kỳ file nào còn thiếu → agent PHẢI tạo file đó ngay trước khi báo cáo hoàn thành. **Không được báo cáo "plan done" khi còn artifact thiếu.**

   Nội dung tối thiểu cho mỗi file nếu phải tạo bổ sung:
   - `research.md`: Codebase analysis, technology decisions, risks từ spec đã đọc
   - `data-model.md`: Entities, SQL queries/interfaces, Redis keys, state transitions
   - `quickstart.md`: Danh sách kịch bản test + verification notes
   - `contracts/<name>-api.md`: HTTP contract đầy đủ (method, path, request body, all response codes)

5. **Stop and report**: Command ends after Phase 2 planning. Report branch, IMPL_PLAN path, và **danh sách TẤT CẢ artifacts đã tạo** (bao gồm path tuyệt đối).

6. **Check for extension hooks**: After reporting, check if `.specify/extensions.yml` exists in the project root.
   - If it exists, read it and look for entries under the `hooks.after_plan` key
   - If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
   - Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
   - For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
     - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
     - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
   - For each executable hook, output the following based on its `optional` flag:
     - **Optional hook** (`optional: true`):
       ```
       ## Extension Hooks

       **Optional Hook**: {extension}
       Command: `/{command}`
       Description: {description}

       Prompt: {prompt}
       To execute: `/{command}`
       ```
     - **Mandatory hook** (`optional: false`):
       ```
       ## Extension Hooks

       **Automatic Hook**: {extension}
       Executing: `/{command}`
       EXECUTE_COMMAND: {command}
       ```
   - If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Phases

### Phase 0: Outline & Research

**[KHÔNG ĐƯỢC BỎ QUA — kể cả khi constitution rỗng hoặc không có NEEDS CLARIFICATION]**

1. **Extract unknowns từ FEATURE_SPEC và Technical Context**:
   - Mọi điểm "NEEDS CLARIFICATION" trong spec
   - Mọi dependency, integration, external service
   - Mọi technology/pattern choice chưa được code trong codebase

2. **Phân tích codebase** (bắt buộc):
   - Đọc các file liên quan trong `src/` để hiểu pattern hiện có
   - Xác định những gì có thể reuse và những gì phải tạo mới
   - Ghi lại tất cả findings

3. **Consolidate findings** vào `research.md` theo format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output bắt buộc**: `research.md` phải tồn tại và có nội dung (không được là file rỗng)

### Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable
   - SQL queries / Redis keys nếu có

2. **Define interface contracts** → `contracts/<feature-name>-api.md`:
   - Áp dụng với mọi feature có external-facing API/interface
   - Chỉ skip nếu feature là purely internal (không có controller, không có public endpoint)
   - Nội dung: HTTP method + path, request body schema, tất cả response codes và error codes

3. **Generate quickstart guide** → `quickstart.md`:
   - Danh sách kịch bản test chính (happy path + error cases)
   - Verification notes (những điều cần kiểm tra sau khi implement)
   - **BẮT BUỘC** — không phải optional

4. **Agent context update**:
   - Update the plan reference between the `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers in `AGENTS.md` to point to the plan file created in step 1 (the IMPL_PLAN path)
   - Chỉ thực hiện nếu tìm thấy markers trong `AGENTS.md`

**Output bắt buộc**: `data-model.md` + `contracts/<name>-api.md` + `quickstart.md` — tất cả phải tồn tại

## Key rules

- Use absolute paths for filesystem operations; use project-relative paths for references in documentation and agent context files
- ERROR on gate failures or unresolved clarifications
- **KHÔNG ĐƯỢC báo cáo hoàn thành nếu Artifact Completeness Gate (bước 4 Outline) chưa pass**
- **Script failure không phải lý do để bỏ qua bất kỳ artifact nào** — dùng manual path resolution thay thế
- **Constitution rỗng không phải lý do để bỏ qua research.md** — vẫn phải tạo dựa trên codebase analysis
