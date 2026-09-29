# HireTrust — Interview Verification System

This package is a functional front-end prototype demonstrating the requested candidate and interviewer flows.

## Included
- Admin dashboard
- Candidate login
- Identity verification UI
- Government ID + selfie workflow placeholder
- Room verification (front/back/left/right)
- Device verification workflow
- Single-display status
- Full-screen/focus warning simulation
- Second focus violation termination
- Camera/microphone status UI
- Speaker verification status UI
- Security/audit events
- Candidate/session/audit/settings pages
- Interviewer live monitoring page
- Privacy/consent messaging

## Run

For the camera to work reliably, serve the folder through `localhost` instead of opening the HTML file directly.

### Option 1 — Python
From this folder run:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000`

### Option 2 — VS Code
Install the **Live Server** extension, right-click `index.html`, and choose **Open with Live Server**.

When the browser asks for camera permission, choose **Allow**.

The camera implementation now uses the browser's `getUserMedia()` API and shows a live preview. It also reports common problems such as denied permission, missing camera, camera already in use, and insecure origin.

For production, connect the UI to a secure backend and implement:
1. Authentication/session management
2. Encrypted ID storage and deletion policy
3. Real face matching through a compliant identity provider
4. Consent-based audio processing and speaker verification
5. WebRTC camera/microphone handling
6. Server-side event/audit storage
7. Secure browser or signed desktop agent for application/display controls
8. Role-based interviewer/admin access
9. CSRF protection, rate limiting, secure cookies and HTTPS
10. Privacy notice, retention schedule and user deletion workflow

## Important browser limitations
A normal web page cannot reliably:
- inspect every application running on the computer
- close unrelated applications
- guarantee that a phone is physically nearby
- prevent all operating-system shortcuts
- reliably detect every secondary device

Use a secure browser or dedicated desktop agent when those controls are required.

## Interviewer Portal

The interviewer monitoring page now includes:
- Live candidate camera preview with connect/disconnect controls
- Real-time verification status refresh
- Warning counter and warning action
- Interview termination action
- Pass / Reject / Needs Review decision controls
- Room verification status
- Security event timeline
- Candidate camera connection status

### Live camera architecture

The demo can access a camera locally. For an actual remote candidate/interviewer setup, use an authenticated WebRTC connection:
Candidate browser -> WebRTC media server/signaling -> Interviewer browser.

Do not expose camera streams publicly. Authenticate the session, authorize the interviewer, use HTTPS/WSS, and protect session identifiers.

## Latest security changes
- Interview requires browser full-screen mode before starting.
- Any tab/window visibility change or full-screen exit immediately terminates the candidate session.
- Completed/terminated sessions are persisted and shown on the Interview Verification Dashboard with candidate details and Pass/Failed/Pending result.
- Interviewer and candidate passwords require at least 6 characters and one special character.
- Audio recording requires explicit candidate consent and is stored as session audio chunks on the server for permitted review.
- Voice monitoring in this prototype is advisory (audio activity/silence anomaly alerts). It does not perform automated biometric voice identification or make hiring decisions. A production deployment should obtain legal/privacy review before any biometric voice processing.

### Running
```bash
npm start
```
Then open http://localhost:8000.

## Latest updates
- Government ID upload is restricted to PDF and JPG/JPEG with immediate candidate-facing validation.
- Full-screen has an explicit pre-interview enable step and is mandatory during the interview.
- Tab/window visibility changes and full-screen exit terminate the session.
- Prolonged silence (no detected microphone audio) produces a candidate warning and is recorded for interviewer review.
- Interviewer dashboard no longer exposes a Candidate Login option after interviewer login.
- Candidate and interviewer call panels show each person's name and User ID.
- Added a browser-based WebRTC signaling layer so the candidate and interviewer can exchange live camera streams when both sides use the same interview session.

### WebRTC note
The demo uses browser WebRTC with a public STUN server. For production, use authenticated signaling, HTTPS/WSS, TURN infrastructure, access control, and short-lived session credentials. Do not expose raw session signaling endpoints without authentication.

## New v3 features
- Valid email format enforced on signup/login and scheduling.
- Interview scheduling stores date/time and sends email notifications to candidate + interviewer when SMTP is configured.
- Passed/Failed result emails can be sent to the candidate.
- A terminated interview is recorded as `Failed` and can trigger the candidate result email.
- Candidate verification selfie is stored with the session for interviewer review.
- Candidate/interviewer audio is carried over WebRTC and both sides display a live audio level meter with a yellow threshold line.
- Silence warnings are generated after prolonged lack of audio.
- Government ID accepts only PDF or JPG/JPEG.

### Email setup
1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set your SMTP host, port, username, password and sender address.
4. Start with `npm start`.

This simple Node server does not automatically load `.env`; export the variables in your shell or use an environment loader in production. For Windows PowerShell, for example:

```powershell
$env:SMTP_HOST="smtp.example.com"
$env:SMTP_PORT="587"
$env:SMTP_USER="your-user"
$env:SMTP_PASS="your-password"
$env:SMTP_FROM="HireTrust <no-reply@example.com>"
npm start
```

### Important security/technical limits
- A normal browser cannot safely close arbitrary background applications. Use a managed secure browser or signed desktop agent for that requirement.
- Face-photo comparison is exposed as an interviewer-review workflow in this version; it does not automatically reject an employment candidate based on biometric similarity. A production implementation should use a compliant identity-verification provider and human review.
- Raw ID images and selfie data are sensitive and should be encrypted, access-controlled, and deleted according to a defined retention policy.

## Email Settings

The Interviewer/Admin **Settings** page now includes a dedicated SMTP configuration panel.

- SMTP host, port, username and From address
- Secure TLS toggle
- Password/App Password field
- Save configuration to the local server
- Password is encrypted at rest and is never returned to the browser
- SMTP connection/test email button
- Clear configured/not-configured status

The schedule and result-email APIs automatically use the saved SMTP settings, falling back to environment variables when no saved setting exists.

### First-time setup

```bash
npm install
npm start
```

Open `http://localhost:8000`, sign in as an interviewer, then open **Settings → Email Settings**. Enter your SMTP details and click **Save Email Settings**. Use **Send Test Email** before scheduling interviews.

For Gmail, use an App Password rather than your normal account password. In production, protect the settings endpoints with authenticated admin/interviewer authorization and use HTTPS.


## v4 changes
- Branding changed from ProctorGuard to HireTrust.
- Added advisory eye/gaze monitoring using browser face landmarks; alerts are sent to the interviewer for review.
- Added optional phone companion heartbeat. Multiple phones can be registered per session and shown to the interviewer.
- Network-level phone presence is not treated as a physical 50-meter distance measurement because Wi-Fi/IP data cannot provide reliable distance.
- Added monitoring-event storage for eye and device alerts.
- Background application blocking still requires a secure browser or signed desktop agent; a normal browser cannot safely close arbitrary apps.

### Phone companion test
During a test session, open `/phone.html` on each phone that is present and enter the session ID. The interviewer will see the number of active companion phones. This is a network-presence signal, not a distance meter.

## Email Verification (Candidate + Interviewer)

Account verification now uses **email verification links only**. SMS, WhatsApp, and OTP verification have been removed.

During account creation:
1. The user enters a valid email address.
2. HireTrust creates the account in an unverified state.
3. HireTrust sends a verification link to that email.
4. The user clicks **Verify Email** in the message.
5. The account becomes verified and can then be used to log in.

The verification link expires after 24 hours and is single-use. Login does not request a code.

### Email configuration

Interviewer/Admin dashboard -> Settings -> Email Settings.

Enter SMTP Host, Port, Username, App Password/Password, and From Email, save the settings, and use **Send Test Email** before creating accounts. Nodemailer is included in `package.json`; run `npm install` once after extracting the project.

If SMTP is not configured, account creation will not complete because HireTrust cannot deliver the required verification email.



### Profile picture limits

Profile pictures are limited to JPG/JPEG or PNG and approximately 1.3 MB to keep the JSON-based prototype database manageable. For production, move profile images to encrypted object storage and store only a protected file reference in the database.



## Signup troubleshooting

Run `npm install` before `npm start` so Nodemailer is installed. Email verification requires working SMTP settings in the HireTrust Email Settings page. The server now reports the actual signup error instead of the generic `Invalid request.` message. Node 18+ is recommended.


## v8 changes

- Removed all OTP and email-verification requirements from account creation and login.
- Candidate/interviewer registration supports email OR international phone number, username/User ID, password, date of birth, optional profile picture, and optional contact-sync permission.
- Added a dedicated Interview Schedule page for interviewers.
- Added a candidate-side schedule view showing upcoming and past interview sessions.
- Interview schedules continue to send email notifications to the candidate and interviewer when SMTP is configured.
- Candidate sessions are filtered by candidate User ID; interviewer sessions are filtered by interviewer User ID.
- Account creation no longer depends on SMTP, so SMTP configuration is not required to create an account.


## Candidate Verification Flow (restored)
After a candidate selects a scheduled interview and clicks Start Verification:
1. Explicit audio consent is requested.
2. Camera + microphone are opened.
3. Live selfie is captured.
4. Government ID accepts PDF or JPG/JPEG only.
5. The submitted ID and selfie are stored with the session for interviewer review.
6. Verification audio is recorded with consent and a live input meter is shown; prolonged silence is warned to the candidate.
7. Room verification captures Front, Right, Left and Back separately.
8. Device verification and full-screen readiness follow before the interview starts.

The interviewer dashboard retains the existing Dashboard, Schedule, Candidates, Interview Sessions, Audit Logs, Timing Log, Profile, Settings and Sign Out navigation.

Facial similarity is treated as an identity-review aid. The system does not automatically make an employment decision solely from biometric facial similarity.

## HireTrust v8 restored + professional UI

This build preserves the candidate verification flow and interviewer navigation while adding:
- Age eligibility: account holder must be older than 21 (22+).
- Separate Email and Phone fields during registration; at least one contact method is required.
- Phone shown as a dedicated column in candidate/schedule/timing views.
- Robust event-driven interviewer sidebar navigation for Dashboard, Schedule, Candidates, Interview Sessions, Audit Logs, Timing Log, Profile, Settings and AI Insights.
- Professional responsive UI/UX refresh.
- AI-assisted advisory dashboard summarizing verification/session signals. It does not make automated hiring decisions.
- Candidate/interviewer profile and session timing support retained.
- Candidate verification flow retained: audio consent/recording, camera/selfie, government ID, four room directions, device verification and full-screen readiness.

### Important platform limitations
A normal browser cannot reliably measure physical phone distance in meters or close arbitrary background applications. Stronger device enforcement requires a managed secure browser or signed desktop agent. Face/voice/gaze signals are presented as verification or monitoring aids and should not be used as the sole basis for employment decisions.

## v10 updates
- Four room captures are compared using image signatures so duplicate/near-duplicate captures are rejected.
- Audio meters update using a fixed layout/transform to avoid page shaking.
- Interview-only AI assistant is available inside the live interview screen and is restricted to interview-process/technical guidance; it does not answer interview questions.
- Dashboard includes a search bar and a HireTrust project overview; scheduling and email notification controls live only under Schedule.
- Candidate feedback is collected after a candidate completes an interview and appears in the interviewer-only Candidate Feedback page.
- Schedule email failures now return the underlying SMTP error to make configuration problems diagnosable.

### Email notifications
Actual outbound email requires a configured SMTP provider. The app cannot send mail from a browser or server without a mail account/provider. Configure SMTP in Settings and use Send Test Email before scheduling. `smtp_not_configured` means the server has no host/user/password/from configuration; it is not an application scheduling failure.


## v12 updates
- Present photo is now required for both candidate and interviewer account creation (JPG/JPEG or PNG).
- Dashboard search now searches candidate accounts by name, User ID, email and phone as well as session history.
- Optional MongoDB Atlas persistence is supported with `MONGODB_URI` and `MONGODB_DB`; the app hydrates from MongoDB at startup and mirrors saves to the `hiretrust_state` collection.
- The interview-only HireTrust AI assistant remains available inside active interviews for process and technical guidance.


## HireTrust v13: MongoDB-only deployment

HireTrust now requires MongoDB Atlas at startup and no longer reads or writes `database.json`. Set `MONGODB_URI` and `MONGODB_DB` in `.env`. The application stores UTC timestamps and displays scheduled/interview times in `APP_TIMEZONE` (default `Asia/Kolkata`, shown as IST).

If you have an older `database.json`, migrate it to MongoDB before deleting it. Do not commit `.env`, SMTP passwords, or MongoDB credentials to source control.

### Gmail notifications
Use `smtp.gmail.com`, port `465`, your sender Gmail address as `SMTP_USER`/`SMTP_FROM`, and a Google App Password as `SMTP_PASS`. Candidate email addresses are recipients, not SMTP credentials.

### Search
Dashboard search now searches both candidate accounts and interview sessions by name, username, email, phone, session ID, interviewer and status.

## Password reset

HireTrust now includes a **Forgot password?** flow on both interviewer and candidate login pages.

1. The user enters the email address registered on the account.
2. HireTrust sends a single-use password-reset link through the configured SMTP/Gmail account.
3. The link expires after 15 minutes and the token is stored only as a SHA-256 hash.
4. The new password must be at least 6 characters and contain at least one special character.

For Render, set `PUBLIC_APP_URL` to the public HTTPS URL of the deployed service, for example:

`PUBLIC_APP_URL=https://your-service.onrender.com`

If `PUBLIC_APP_URL` is omitted, HireTrust falls back to the incoming request host when generating the link.


## HireTrust v18 additions

- Interviewer live control center now includes an elapsed interview clock and browser online/offline status.
- Real-time interviewer monitoring panel refreshes persisted monitor events and violations into the security timeline.
- Interview evaluation form saves technical knowledge, communication, problem-solving and role-knowledge ratings (1–5) plus private interviewer notes to the MongoDB-backed session record.
- Quick-insert sample interview questions are available for Python, SQL, problem-solving and REST API discussions.
- Interview report can be opened and printed or saved as PDF from the browser print dialog. The report includes candidate/session details, verification summary, interviewer evaluation and a security timeline.
- Session records now preserve the `interviewerReview` and `consentRecord` fields.

These are incremental improvements on the existing app. Production features such as a managed desktop agent, guaranteed OS app blocking, physical Wi-Fi distance measurement and robust liveness verification require separate architecture or specialized providers; the browser does not claim to provide them.


## HireTrust v19 — Full Interview Operations Upgrade

This release adds the requested multi-phase platform features in one build: waiting room/admission, live Operations Center, structured interview question bank and per-session question plans, analytics, notifications, email 2FA for interviewer/admin accounts, rate-limited login attempts, admin console with privacy-retention controls, consent records, connection-quality telemetry, calendar `.ics` export, expanded audit events, and enterprise-oriented security controls.

### Optional admin account
Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_USER_ID` in `.env` before starting the server. On startup, HireTrust provisions the admin account if it does not already exist. Keep the admin password secret and change it before production use.

### Browser limitations
HireTrust continues to distinguish browser-enforceable controls from OS-level controls. A standard browser cannot reliably close arbitrary desktop applications, determine another Wi-Fi device's physical distance in meters, or guarantee that no external device is present. Stronger enforcement requires a managed secure browser or signed desktop agent.
