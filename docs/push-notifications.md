# Push notifications (Firebase Cloud Messaging)

Each person taps **Bật thông báo** on Tracking Golive on the phone or computer that should receive pushes.
The browser's FCM token is saved in `push_tokens` for that account. On iPhone/iPad (iOS 16.4+), first add the site to the Home Screen and open it from there.

Who gets what:

| Event | Recipients |
| --- | --- |
| A QE confirms the web test | Manager, PM |
| Every QE confirmed the web test | everyone |
| Manager taps remind (web phase) | QEs who have not confirmed |
| A QE's last open ticket/checklist turns Done | Manager, PM |
| Every ticket of the release is Done | everyone |
| Release completed | everyone |

Setup (once): create a Firebase project and a Web app, then set three hosted runtime values (see `.env.example`):
`FIREBASE_WEB_CONFIG` (web app config JSON), `FIREBASE_VAPID_KEY` (Cloud Messaging → Web Push certificates),
`FIREBASE_SERVICE_ACCOUNT` (Project settings → Service accounts → Generate new private key, as one-line JSON; secret).
Until all three are set, the button says push is not configured and nothing is sent.
Sending is best effort and never blocks a golive action; tokens FCM reports as unknown (404) are deleted.
