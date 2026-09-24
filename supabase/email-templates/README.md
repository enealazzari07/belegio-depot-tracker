# Supabase-Mailvorlagen (Stox-Design)

Erzeugt mit `python3 scripts/build-mail-templates.py`. In Supabase unter
Authentication → Email Templates je Vorlage Betreff und den Inhalt der Datei
als "Message body" einfügen.

| Supabase-Vorlage | Datei | Betreff |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `{{ .Token }} · Bestätige deine E-Mail · Stox` |
| Invite user | `invite.html` | `Du wurdest zu Stox eingeladen` |
| Magic Link | `magic-link.html` | `Dein Login-Code · Stox` |
| Change Email Address | `change-email.html` | `Neue E-Mail bestätigen · Stox` |
| Reset Password | `reset-password.html` | `{{ .Token }} · Passwort ändern · Stox` |
| Reauthentication | `reauthentication.html` | `{{ .Token }} · Bestätigungscode · Stox` |

## Sicherheitshinweise (Security notifications)

In Supabase unter Authentication → Email Templates → Security notifications
die jeweilige Benachrichtigung **aktivieren** und Betreff + Inhalt einfügen.

| Supabase-Vorlage | Datei | Betreff |
|---|---|---|
| Password changed | `password-changed.html` | `Dein Passwort wurde geändert · Stox` |
| Email address changed | `email-changed.html` | `Deine E-Mail-Adresse wurde geändert · Stox` |
| Phone number changed | `phone-changed.html` | `Deine Telefonnummer wurde geändert · Stox` |
| Sign-in method linked | `identity-linked.html` | `Neue Anmeldemethode verknüpft · Stox` |
| Sign-in method removed | `identity-unlinked.html` | `Anmeldemethode entfernt · Stox` |
| Verification method added | `mfa-enrolled.html` | `Neue Bestätigungsmethode hinzugefügt · Stox` |
| Verification method removed | `mfa-unenrolled.html` | `Bestätigungsmethode entfernt · Stox` |
