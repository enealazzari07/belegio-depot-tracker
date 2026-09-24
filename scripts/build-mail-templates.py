"""Erzeugt die Supabase-Auth-Mailvorlagen (supabase/email-templates/*.html)
im Stox-Design: Login-Hintergrundbild, grosses Logo, weisse abgerundete Box.
Einmal ausfuehren, dann den Inhalt der jeweiligen Datei in Supabase unter
Authentication > Email Templates einfuegen (Betreff steht in README.md)."""
import os

BASE = "https://belegio-depot-tracker.vercel.app"
BG = BASE + "/img/mail-bg.jpg"
LOGO = BASE + "/img/stox-logo.png"
FONT = "'Nunito',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
OUT = os.path.join(os.path.dirname(__file__), "..", "supabase", "email-templates")


def button(label, url):
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#16171D" style="border-radius:999px;background:#16171D">
<a href="{url}" style="display:block;padding:17px 24px;font-family:{FONT};font-size:15.5px;font-weight:800;color:#FFFFFF;text-decoration:none;border-radius:999px">{label}</a>
</td></tr></table>
<p style="margin:22px 0 0;font-family:{FONT};font-size:11.5px;line-height:1.6;color:#AEB2C0;word-break:break-all">Button geht nicht? Link kopieren:<br><a href="{url}" style="color:#7A7FA8">{url}</a></p>"""


def codebox(token):
    # Ein Tipp markiert den ganzen Code (user-select:all), ohne Leerzeichen –
    # iOS/Android bieten "Code kopieren" bzw. Autofill an.
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#EEF0FB" style="border-radius:22px;background:#EEF0FB;padding:22px 10px 16px">
<div style="font-family:{FONT};font-size:40px;font-weight:800;letter-spacing:10px;color:#000000;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;-webkit-user-select:all;user-select:all;cursor:text">{token}</div>
<div style="margin-top:8px;font-family:{FONT};font-size:12px;font-weight:600;color:#8A90A6">Antippen und kopieren · in der App einfügen</div>
</td></tr></table>"""


def page(pre, title, text, action, note):
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#EEF0F5;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EEF0F5" style="background:#EEF0F5">
<tr><td align="center" style="padding:28px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td background="{BG}" bgcolor="#A3ACF6" style="background:#A3ACF6 url('{BG}') center top / cover no-repeat;border-radius:36px;padding:46px 12px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:0 20px">
<img src="{LOGO}" width="190" alt="Stox" style="display:block;width:190px;max-width:70%;height:auto;border:0;margin:0 auto">
<p style="margin:14px 0 0;font-family:{FONT};font-size:15px;font-weight:600;color:#2A2C3A;opacity:.8">Dein Depot, ohne Tabellen.</p>
</td></tr>
<tr><td style="height:40px;line-height:40px;font-size:0">&nbsp;</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:28px;padding:36px 28px 30px;box-shadow:0 18px 40px -22px rgba(20,24,60,.35)">
<h1 style="margin:0 0 12px;font-family:{FONT};font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.5px;color:#16171D">{title}</h1>
<p style="margin:0 0 26px;font-family:{FONT};font-size:15px;line-height:1.6;color:#5F6576">{text}</p>
{action}
<p style="margin:24px 0 0;font-family:{FONT};font-size:12.5px;line-height:1.55;color:#9096A5">{note}</p>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:22px 20px 0;font-family:{FONT};font-size:12px;line-height:1.6;color:#9298A8">Stox · Dein Depot, ohne Tabellen.<br>Du hast diese E-Mail nicht angefordert? Dann ignorier sie einfach.</td></tr>
</table>
</td></tr></table>
</body></html>
"""


T = {
    "confirm-signup": ("Bestätige deine E-Mail · Stox", page(
        "Ein Tipp noch, dann ist dein Stox-Konto startklar.",
        "Willkommen bei Stox",
        "Schön, dass du da bist! Bestätige kurz deine E-Mail-Adresse – danach ist dein Konto startklar und du kannst deinen ersten Beleg scannen.",
        button("E-Mail bestätigen", "{{ .ConfirmationURL }}"),
        "Der Link ist 24 Stunden gültig.")),
    "invite": ("Du wurdest zu Stox eingeladen", page(
        "Du wurdest zu Stox eingeladen.",
        "Du bist eingeladen",
        "Jemand hat dich zu Stox eingeladen – deinem Depot-Tagebuch ohne Tabellen. Nimm die Einladung an und leg dein Passwort fest.",
        button("Einladung annehmen", "{{ .ConfirmationURL }}"),
        "Du kennst Stox nicht? Dann ignorier diese Mail einfach.")),
    "magic-link": ("Dein Login-Code · Stox", page(
        "Dein Stox-Login-Code: {{ .Token }}",
        "Dein Login-Code",
        "Gib diesen Code in der App ein, um dich anzumelden.",
        codebox("{{ .Token }}"),
        "Der Code ist nur kurz gültig und funktioniert einmal.")),
    "change-email": ("Neue E-Mail bestätigen · Stox", page(
        "Bestätige deine neue E-Mail-Adresse für Stox.",
        "Neue E-Mail bestätigen",
        "Du möchtest die E-Mail-Adresse deines Stox-Kontos auf {{ .NewEmail }} ändern. Bestätige die Änderung über den Button.",
        button("Änderung bestätigen", "{{ .ConfirmationURL }}"),
        "Du hast das nicht angefragt? Dann ignorier diese Mail – deine Adresse bleibt unverändert.")),
    "reset-password": ("{{ .Token }} · Passwort ändern · Stox", page(
        "Dein Stox-Code: {{ .Token }}",
        "Neues Passwort festlegen",
        "Du möchtest das Passwort für dein Stox-Konto ändern. Gib diesen Code in der App ein und wähle dann dein neues Passwort.",
        codebox("{{ .Token }}"),
        "Der Code ist nur kurz gültig und funktioniert einmal. Dein altes Passwort bleibt gültig, bis du ein neues festlegst.")),
    "reauthentication": ("{{ .Token }} · Bestätigungscode · Stox", page(
        "Dein Stox-Bestätigungscode: {{ .Token }}",
        "Bestätigungscode",
        "Gib diesen Code in der App ein, um die Aktion zu bestätigen.",
        codebox("{{ .Token }}"),
        "Der Code ist nur kurz gültig. Du hast nichts angefragt? Dann ignorier diese Mail.")),
}

NAMES = {
    "confirm-signup": "Confirm signup", "invite": "Invite user", "magic-link": "Magic Link",
    "change-email": "Change Email Address", "reset-password": "Reset Password", "reauthentication": "Reauthentication",
}

os.makedirs(OUT, exist_ok=True)
readme = ["# Supabase-Mailvorlagen (Stox-Design)", "",
          "Erzeugt mit `python3 scripts/build-mail-templates.py`. In Supabase unter",
          "Authentication → Email Templates je Vorlage Betreff und den Inhalt der Datei",
          "als \"Message body\" einfügen.", "",
          "| Supabase-Vorlage | Datei | Betreff |", "|---|---|---|"]
for key, (subject, html) in T.items():
    with open(os.path.join(OUT, key + ".html"), "w") as f:
        f.write(html)
    readme.append(f"| {NAMES[key]} | `{key}.html` | `{subject}` |")
with open(os.path.join(OUT, "README.md"), "w") as f:
    f.write("\n".join(readme) + "\n")
print("ok", len(T))
