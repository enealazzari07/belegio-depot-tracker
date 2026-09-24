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
<div class="code" style="font-family:{FONT};font-size:40px;text-decoration:none;font-weight:800;letter-spacing:10px;color:#000000;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:'tnum' 1,'lnum' 1;-webkit-user-select:all;user-select:all;cursor:text">{token}</div>
<div style="margin-top:8px;font-family:{FONT};font-size:12px;font-weight:600;color:#8A90A6">Antippen und kopieren · in der App einfügen</div>
</td></tr></table>"""


def infobox(rows):
    # Detail-Karte fuer Sicherheitshinweise: Zeilen (Label, Wert)
    cells = "".join(
        f"""<tr><td style="padding:{'0' if i == 0 else '12px'} 0 0;font-family:{FONT}">
<div style="font-size:11.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8A90A6">{k}</div>
<div style="margin-top:3px;font-size:15px;font-weight:800;color:#16171D;word-break:break-all">{v}</div>
</td></tr>""" for i, (k, v) in enumerate(rows))
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#EEF0FB" style="border-radius:22px;background:#EEF0FB;padding:18px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{cells}</table>
</td></tr></table>"""


def warnbox(text):
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td bgcolor="#FFF1F0" style="border-radius:22px;background:#FFF1F0;padding:16px 20px;font-family:{FONT}">
<div style="font-size:14px;font-weight:800;color:#D93A2B">Das warst du nicht?</div>
<div style="margin-top:4px;font-size:13.5px;line-height:1.55;color:#7A4A45">{text}</div>
</td></tr></table>"""


def notice(rows, warn, label="Stox öffnen"):
    return (infobox(rows) if rows else "") + warnbox(warn) + \
        '<div style="height:22px;line-height:22px;font-size:0">&nbsp;</div>' + \
        button(label, BASE).split("<p ")[0]


SEC_FOOT = "Stox · Dein Depot, ohne Tabellen.<br>Sicherheitshinweis zu deinem Konto – diese Mail bekommst du immer, wenn sich etwas Wichtiges ändert."
WARN_PW = "Dann setz sofort ein neues Passwort: Öffne Stox, tippe beim Login auf „Passwort vergessen“ und folge den Schritten. Melde dich zusätzlich beim Support."


def page(pre, title, text, action, note, badge=None, foot=None):
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="x-apple-disable-message-reformatting">
<style>a[x-apple-data-detectors],.code a,#MessageViewBody .code a,u + #body .code a{{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;pointer-events:none!important;cursor:text!important}}</style>
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
{f'<div style="display:inline-block;margin:0 0 14px;padding:6px 12px;border-radius:999px;background:{badge[1]};font-family:{FONT};font-size:11.5px;font-weight:800;letter-spacing:.3px;color:{badge[2]}">{badge[0]}</div>' if badge else ''}
<h1 style="margin:0 0 12px;font-family:{FONT};font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.5px;color:#16171D">{title}</h1>
<p style="margin:0 0 26px;font-family:{FONT};font-size:15px;line-height:1.6;color:#5F6576">{text}</p>
{action}
<p style="margin:24px 0 0;font-family:{FONT};font-size:12.5px;line-height:1.55;color:#9096A5">{note}</p>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:22px 20px 0;font-family:{FONT};font-size:12px;line-height:1.6;color:#9298A8">{foot or "Stox · Dein Depot, ohne Tabellen.<br>Du hast diese E-Mail nicht angefordert? Dann ignorier sie einfach."}</td></tr>
</table>
</td></tr></table>
</body></html>
"""


T = {
    "confirm-signup": ("{{ .Token }} · Bestätige deine E-Mail · Stox", page(
        "Dein Stox-Code: {{ .Token }}",
        "Willkommen bei Stox",
        "Schön, dass du da bist! Gib diesen Code in der App ein, um deine E-Mail-Adresse zu bestätigen – danach bist du direkt angemeldet und kannst deinen ersten Beleg scannen.",
        codebox("{{ .Token }}"),
        "Der Code ist nur kurz gültig und funktioniert einmal.")),
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

OK = ("Sicherheitshinweis", "#E7F7EE", "#1E8A4F")
SEC = {
    "password-changed": ("Dein Passwort wurde geändert · Stox", page(
        "Das Passwort deines Stox-Kontos wurde gerade geändert.",
        "Passwort geändert",
        "Das Passwort für dein Stox-Konto wurde soeben geändert. Warst du das, ist alles in Ordnung – du musst nichts weiter tun.",
        notice([("Konto", "{{ .Email }}"), ("Änderung", "Neues Passwort gespeichert")], WARN_PW),
        "Aus Sicherheitsgründen nennen wir dein Passwort nie per Mail.", OK, SEC_FOOT)),
    "email-changed": ("Deine E-Mail-Adresse wurde geändert · Stox", page(
        "Die E-Mail-Adresse deines Stox-Kontos wurde geändert.",
        "E-Mail geändert",
        "Die E-Mail-Adresse deines Stox-Kontos wurde erfolgreich geändert. Ab jetzt meldest du dich mit der neuen Adresse an.",
        notice([("Vorher", "{{ .OldEmail }}"), ("Jetzt", "{{ .Email }}")],
               "Dann hat womöglich jemand Zugriff auf dein Konto. Antworte auf diese Mail oder melde dich beim Support, damit wir dein Konto sichern können."),
        "Warst du das, musst du nichts weiter tun.", OK, SEC_FOOT)),
    "phone-changed": ("Deine Telefonnummer wurde geändert · Stox", page(
        "Die Telefonnummer deines Stox-Kontos wurde geändert.",
        "Telefonnummer geändert",
        "Die Telefonnummer deines Stox-Kontos wurde geändert.",
        notice([("Vorher", "{{ .OldPhone }}"), ("Jetzt", "{{ .Phone }}")], WARN_PW),
        "Warst du das, musst du nichts weiter tun.", OK, SEC_FOOT)),
    "identity-linked": ("Neue Anmeldemethode verknüpft · Stox", page(
        "Eine neue Anmeldemethode wurde mit deinem Stox-Konto verknüpft.",
        "Anmeldemethode hinzugefügt",
        "Mit deinem Stox-Konto wurde eine neue Anmeldemethode verknüpft.",
        notice([("Konto", "{{ .Email }}"), ("Methode", "{{ .Provider }}")], WARN_PW),
        "Warst du das, musst du nichts weiter tun.", OK, SEC_FOOT)),
    "identity-unlinked": ("Anmeldemethode entfernt · Stox", page(
        "Eine Anmeldemethode wurde von deinem Stox-Konto entfernt.",
        "Anmeldemethode entfernt",
        "Von deinem Stox-Konto wurde eine Anmeldemethode entfernt.",
        notice([("Konto", "{{ .Email }}"), ("Methode", "{{ .Provider }}")], WARN_PW),
        "Warst du das, musst du nichts weiter tun.", OK, SEC_FOOT)),
    "mfa-enrolled": ("Neue Bestätigungsmethode hinzugefügt · Stox", page(
        "Eine neue Bestätigungsmethode wurde deinem Stox-Konto hinzugefügt.",
        "Bestätigungsmethode hinzugefügt",
        "Deinem Stox-Konto wurde eine neue Bestätigungsmethode (2-Faktor) hinzugefügt.",
        notice([("Konto", "{{ .Email }}"), ("Methode", "{{ .FactorType }}")], WARN_PW),
        "Warst du das, musst du nichts weiter tun.", OK, SEC_FOOT)),
    "mfa-unenrolled": ("Bestätigungsmethode entfernt · Stox", page(
        "Eine Bestätigungsmethode wurde von deinem Stox-Konto entfernt.",
        "Bestätigungsmethode entfernt",
        "Von deinem Stox-Konto wurde eine Bestätigungsmethode (2-Faktor) entfernt.",
        notice([("Konto", "{{ .Email }}"), ("Methode", "{{ .FactorType }}")], WARN_PW),
        "Warst du das, musst du nichts weiter tun.", OK, SEC_FOOT)),
}

NAMES = {
    "confirm-signup": "Confirm signup", "invite": "Invite user", "magic-link": "Magic Link",
    "change-email": "Change Email Address", "reset-password": "Reset Password", "reauthentication": "Reauthentication",
    "password-changed": "Password changed", "email-changed": "Email address changed",
    "phone-changed": "Phone number changed", "identity-linked": "Sign-in method linked",
    "identity-unlinked": "Sign-in method removed", "mfa-enrolled": "Verification method added",
    "mfa-unenrolled": "Verification method removed",
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
readme += ["", "## Sicherheitshinweise (Security notifications)", "",
           "In Supabase unter Authentication → Email Templates → Security notifications",
           "die jeweilige Benachrichtigung **aktivieren** und Betreff + Inhalt einfügen.", "",
           "| Supabase-Vorlage | Datei | Betreff |", "|---|---|---|"]
for key, (subject, html) in SEC.items():
    with open(os.path.join(OUT, key + ".html"), "w") as f:
        f.write(html)
    readme.append(f"| {NAMES[key]} | `{key}.html` | `{subject}` |")
with open(os.path.join(OUT, "README.md"), "w") as f:
    f.write("\n".join(readme) + "\n")
print("ok", len(T) + len(SEC))
