# spec/modules/account/module.md
# Owner: TaiND | Version : 1.0.0

## Service Responsibility 
 modules/account là authority duy nhất cho:
  - account lifecycle management (create/ update/ delete).
  - profile management (view / update own profile and admin-read extended profile)
  - user role assignment management
  - own profile management (view / update hồ sơ cá nhân)
  - face profile enrollment management (enroll / re-enroll / view face enrollment status)
  - publication of account-related domain events for downstream modules

## NOT trong scope của service này: 
  - FE-01 Authentication & Authorization execution:
  login, logout, password reset/change execution, token issuance, token refresh, session persistence, runtime authorization.
  - FE-03 to FE-15 are out of scope for `modules/account`, except:
  - FE-02 Account Management is the primary scope of this module.
  - FE-07 is only touched at face profile enrollment/storage level; attendance runtime and recognition workflow remain out of scope.
  - Email sending, session revocation execution, meeting orchestration, attendance processing, recording, AI processing, minutes repository, export, analytics, and system-wide governance workflows belong to their corresponding modules.

## API Contract (summary)
    - BASE URL : /api/v1/accounts
    - Auth : JWT Bearer (valid scope: accounts:read, accounts:write)
    - Rate limit: 1000 req/min per tenant

## Internal Architecture 
    - Pattern: Layered Architecture + Domain Events + Transactional Outbox
    - DB: PostgreeSQL 18, schema: users, user_profiles, user_roles, face_profiles, face_profile_samples.
    - Events published: account.created, account.updated, account.status_changed, profile.updated, face_profile.enrolled, account.removal_completed.
    - Events consumed: auth.login_succeeded, auth.sessions_revoked, notification.delivery_failed.

## Module-level Constraints
 - Other modules SHALL NOT depend on synchronous request/response calls to modules/account for runtime business validation or read paths.
 - Cross-module propagation from account SHOULD use domain events / replicated read models / token claims.