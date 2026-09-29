# HireTrust — AI-Assisted Interview Verification & Proctoring

HireTrust is a web-based interview verification and monitoring platform for candidates, interviewers, and administrators. It combines identity and environment verification, live interview communication, security monitoring, interview scheduling, structured evaluations, analytics, notifications, and audit controls in one workspace.

> **Important:** AI-assisted verification and monitoring features are advisory. HireTrust does not automatically make employment decisions from facial, voice, gaze, or other biometric-style signals.

## Current capabilities

### Candidate experience
- Candidate account registration and login.
- Email or international phone contact during registration.
- Profile photo capture/upload with JPG/JPEG/PNG validation.
- Date-of-birth eligibility check (22+ in the current build).
- Scheduled-interview list and session-specific verification flow.
- Waiting-room/admission flow before verification.
- Explicit consent recording for interview monitoring/recording.
- Live camera and microphone access through browser media APIs.
- Live selfie capture for identity review.
- Government ID upload restricted to PDF or JPG/JPEG.
- Four separate room-verification captures: Front, Back, Left, and Right.
- Duplicate/near-duplicate room capture checks using image signatures.
- Device/display readiness checks.
- Mandatory full-screen mode during the interview.
- Tab/window visibility monitoring and focus-violation handling.
- Candidate audio activity/silence monitoring with advisory warnings.
- WebRTC candidate/interviewer video and audio communication.
- Session chat with the interviewer.
- Phone companion heartbeat for network-level companion presence.
- Candidate feedback after completed interviews.
- Interview result email support when SMTP is configured.

### Interviewer workspace
- Dashboard with candidate/session search and interview history.
- Interview scheduling and candidate assignment.
- Candidate profile and session details.
- Live interview control center.
- Candidate video preview and interviewer self-preview.
- Candidate and interviewer audio meters/status indicators.
- Real-time security/monitoring event timeline.
- Identity, room, camera, microphone, eye/gaze, phone/network and display status indicators.
- Interview decision controls: Pass, Reject/Failed, or Needs Review.
- Waiting-room admission controls.
- Structured Interview Question Bank.
- Per-session question plans.
- Quick-insert sample questions for Python, SQL, problem solving, and REST API topics.
- Candidate evaluation form with 1–5 ratings for:
  - Technical knowledge
  - Communication
  - Problem solving
  - Role knowledge
- Private interviewer notes.
- Candidate evaluation history page showing evaluations for each interview session.
- Evaluation details view from candidate history/dashboard.
- Interview report that can be printed or saved as PDF from the browser.
- Candidate/interviewer live chat during an interview.
- Connection-quality telemetry.
- Calendar `.ics` export for scheduled sessions.
- Candidate feedback review.
- SMTP/email configuration and test-email controls.
- Security Center and audit logs.
- AI-assisted interview/process guidance that remains advisory and does not answer interview questions or make hiring decisions.

### Admin and security features
- Optional admin account provisioning through environment variables.
- Admin overview of users and interview-session activity.
- Audit event history.
- Privacy/retention controls with dry-run support and privacy redaction of old session data.
- Email 2FA for interviewer/admin accounts.
- Rate-limited login handling.
- Password reset using single-use, time-limited email links.
- Notifications for session/admission events.
- Consent records associated with interview sessions.
- Security and monitoring event persistence.

## Interview verification and monitoring

A typical candidate flow is:

1. Select a scheduled interview.
2. Enter the waiting room when required.
3. Receive interviewer admission.
4. Review and accept the required consent items.
5. Enable camera and microphone.
6. Capture a live selfie.
7. Upload a government ID (PDF/JPG/JPEG).
8. Complete Front, Back, Left, and Right room verification.
9. Complete device/display and full-screen readiness checks.
10. Join the live interview.
11. Continue camera, audio, focus, room, eye/gaze, and device/network monitoring as applicable.
12. Complete the interview and interviewer evaluation.

Monitoring events and violations are associated with the interview session so the interviewer can review the verification context rather than relying on a single automated signal.

### Browser-enforceable vs. OS-level controls
A normal browser cannot reliably:
- inspect every application running on a computer;
- close unrelated desktop applications;
- guarantee that another device is physically nearby;
- measure Wi-Fi/device distance in reliable meters;
- prevent every operating-system shortcut;
- guarantee that no external device is present.

For stronger desktop enforcement, use a managed secure browser or signed desktop agent. HireTrust treats phone companion presence as a network-level signal, not a physical-distance measurement.

## Live interview communication

HireTrust uses browser WebRTC for live candidate/interviewer media and a server-side signaling layer for session negotiation. The live interview UI includes:

- Candidate video
- Interviewer self-preview
- Candidate audio meter/status
- Interviewer audio meter/status
- Remote audio enable control
- Security/verification status
- Interview chat
- Room-monitoring views
- Security-event timeline
- Structured question plan
- Evaluation and private notes

For production, use authenticated signaling, HTTPS/WSS, TURN infrastructure, authorization checks, short-lived session credentials, and protected session identifiers. Do not expose raw media/signaling endpoints publicly.

## Data and persistence

The current application uses **MongoDB Atlas** as its required persistence layer. The server hydrates its application state from MongoDB at startup and saves users, sessions, question-bank data, notifications, login challenges, password-reset records, and audit information to the `hiretrust_state` document in the configured database.

Interview session records can contain verification and operational data such as:

- Candidate/interviewer details
- Scheduling information
- Verification status
- Room captures
- Selfie/identity-review data
- Monitoring events and violations
- Audio-consent state and permitted audio records
- Phone companion information
- Connection telemetry
- Consent records
- Question plans
- Interviewer evaluation (`interviewerReview`)
- Candidate feedback
- Chat messages
- Interview decision/result

Sensitive identity, audio, and image data should be encrypted, access-controlled, and deleted according to a documented retention policy in a production deployment.

## Interview evaluations

Interview evaluations are stored with the relevant interview session rather than in a separate evaluation database.

The interviewer can save:

- Technical knowledge: 1–5
- Communication: 1–5
- Problem solving: 1–5
- Role knowledge: 1–5
- Private interviewer notes
- Reviewer identity and update time

The Interviewer **Evaluations** page reads these saved session evaluations and shows candidate/session history, overall rating, individual category ratings, notes status, and the last update time.

Ratings and notes are reviewer inputs. They are not an automatic employment decision engine.

## Question Bank

The Question Bank stores reusable interview questions with:

- Question text
- Category
- Difficulty
- Expected topics
- Creator information
- Creation timestamp

Questions can be selected into a session-specific interview plan. The interviewer remains in control of which questions are used.

## Email and authentication

### SMTP
The Settings area supports SMTP configuration including:

- SMTP host
- Port
- Username
- From address
- TLS/secure setting
- Password/App Password
- SMTP connection/test email

Saved SMTP passwords are encrypted at rest by the server and are not returned to the browser.

For Gmail, use a Google App Password rather than a normal Gmail account password.

### Password reset

The **Forgot password?** flow sends a single-use reset link through the configured SMTP provider. The reset token is stored as a SHA-256 hash and expires after 15 minutes.

### Email 2FA

Interviewer/admin accounts can use email-based two-factor authentication. A six-digit sign-in code is generated for a login challenge and expires after 10 minutes. The code is sent through the configured SMTP account and is invalidated after successful verification.

If 2FA email delivery fails, check **Settings → Email Settings → Send Test Email** and verify the SMTP configuration.

## Analytics, notifications, audit and retention

### Analytics
The analytics API/dashboard tracks session-level metrics such as:

- Total sessions
- Completed sessions
- Passed sessions
- Failed/rejected/terminated sessions
- Sessions needing review
- Total warnings
- Average completed-interview duration
- Session status distribution

### Notifications
Session-related notifications can be persisted and marked as read. Examples include candidate waiting-room and admission events.

### Audit trail
Security and operational events can include login activity, 2FA events, waiting-room/admission events, monitoring events, violations, retention actions, and other session activity.

### Retention
Admin retention controls can identify old session records and support a dry-run before privacy-redacting selected sensitive session fields. Production deployments should define and enforce a documented legal/privacy retention schedule.

## Technology

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js HTTP server
- **Database:** MongoDB Atlas
- **Email:** Nodemailer + SMTP
- **Live media:** WebRTC
- **Browser media:** `getUserMedia()` / MediaRecorder where supported
- **Runtime:** Node.js 18+
- **Default application timezone:** `Asia/Kolkata`

## Project structure

```text
HireTrust/
├── index.html
├── app.js
├── styles.css
├── server.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── MONGODB_SETUP.md
├── migrate-json-to-mongo.js
└── assets/
    └── hiretrust-logo.png
```

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example environment file:

```bash
copy .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Set at minimum:

```env
MONGODB_URI=your_mongodb_atlas_connection_string
MONGODB_DB=hiretrust
APP_TIMEZONE=Asia/Kolkata
```

For password-reset links on Render, also set:

```env
PUBLIC_APP_URL=https://your-service.onrender.com
```

If you use an SMTP provider through environment variables, configure its host, port, username, password/App Password, and sender address as documented in `.env.example`.

### 3. Start HireTrust

```bash
npm start
```

Then open:

```text
http://localhost:8000
```

For camera/microphone features, use `localhost` or HTTPS rather than opening `index.html` directly with `file://`.

## MongoDB setup

HireTrust v13 and later use MongoDB Atlas as the required database. The application no longer depends on `database.json` for normal operation.

See `MONGODB_SETUP.md` for the Atlas connection and migration procedure.

If migrating an older HireTrust installation, migrate the legacy data before removing the old JSON database. Do not commit database credentials to Git.

## Render deployment

For a Render deployment:

1. Push the project to GitHub.
2. Create a Render web service from the repository.
3. Use the Node.js environment.
4. Build/install command:

```bash
npm install
```

5. Start command:

```bash
npm start
```

6. Add the required environment variables in Render, especially `MONGODB_URI`, `MONGODB_DB`, and `PUBLIC_APP_URL`.
7. Never put MongoDB, SMTP, or admin passwords directly in source files.

## Git and secrets

Do **not** commit:

```text
.env
node_modules/
smtp-settings.json
.smtp-settings-key
```

Use `.env.example` for safe configuration documentation without real credentials.

Before pushing to GitHub, run:

```bash
git status
git add .
git commit -m "Update HireTrust"
git push origin main
```

## Production security checklist

Before production use, review and harden at least the following:

1. HTTPS/WSS everywhere.
2. Strong authentication and authorization for every protected API.
3. Secure cookies/session management if sessions are added.
4. CSRF protection where cookie-authenticated state changes are used.
5. Login and 2FA rate limiting.
6. TURN infrastructure and authenticated WebRTC signaling.
7. Encryption and strict access control for ID, selfie, audio, and monitoring data.
8. A documented data-retention/deletion policy.
9. Privacy and legal review for identity, audio, gaze, and biometric-style processing.
10. Managed browser or signed desktop-agent controls when OS-level enforcement is required.
11. Production logging, monitoring, backups, and incident-response procedures.
12. Secrets stored only in the deployment environment or a dedicated secret manager.

## Platform limitations and responsible use

HireTrust is designed as an interview verification and monitoring aid. Camera, microphone, room, gaze, audio, phone-presence, and identity signals can be affected by browser permissions, lighting, hardware, network conditions, accessibility needs, and other factors.

Use these signals as review evidence rather than as an infallible automated judgment. In particular, facial similarity, voice activity, eye/gaze alerts, and phone/network presence should not by themselves determine employment outcomes.

## License

No open-source license is declared in this package. Add an appropriate license before publicly distributing the project if required.
