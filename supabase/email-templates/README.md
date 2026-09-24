# Supabase-Mailvorlagen (Stox-Design)

Erzeugt mit `python3 scripts/build-mail-templates.py`. In Supabase unter
Authentication → Email Templates je Vorlage Betreff und den Inhalt der Datei
als "Message body" einfügen.

| Supabase-Vorlage | Datei | Betreff |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `Bestätige deine E-Mail · Stox` |
| Invite user | `invite.html` | `Du wurdest zu Stox eingeladen` |
| Magic Link | `magic-link.html` | `Dein Login-Code · Stox` |
| Change Email Address | `change-email.html` | `Neue E-Mail bestätigen · Stox` |
| Reset Password | `reset-password.html` | `{{ .Token }} · Passwort ändern · Stox` |
| Reauthentication | `reauthentication.html` | `{{ .Token }} · Bestätigungscode · Stox` |
