# Live Quiz Tool

Ein interaktives Quiz-Tool mit Echtzeit-Leaderboard und Schnelligkeitswertung fuer bis zu 50+ Teilnehmende.

## Features
- Teilnehmende treten per QR-Code oder Link bei (Smartphone)
- Multiple-Choice-Fragen mit Timer
- Punkte nach Schnelligkeit (500-1000 Punkte fuer richtige Antworten)
- Live-Leaderboard nach jeder Frage
- Sieger-Podium am Ende

## Anleitung: Deployment auf Glitch.com

### Schritt 1: Account erstellen
1. Gehe auf https://glitch.com
2. Klicke auf "Sign Up" (kostenlos)
3. Registriere dich mit E-Mail oder GitHub

### Schritt 2: Neues Projekt erstellen
1. Klicke auf "New Project"
2. Waehle "glitch-hello-node"
3. Warte bis das Projekt geladen ist

### Schritt 3: Dateien ersetzen
Im Glitch-Editor siehst du links die Dateiliste. Ersetze folgende Dateien:

1. Klicke auf "package.json" und ersetze den Inhalt mit der package.json aus diesem Ordner
2. Klicke auf "server.js" und ersetze den Inhalt mit der server.js aus diesem Ordner
3. Loesche die Datei "index.html" im public-Ordner (falls vorhanden)
4. Klicke auf den "public" Ordner, dann "New File"
   - Erstelle "index.html" und kopiere den Inhalt aus public/index.html
   - Erstelle "host.html" und kopiere den Inhalt aus public/host.html

### Schritt 4: App starten
- Glitch installiert automatisch die Pakete und startet die App
- Klicke oben auf "Preview" > "Open preview in a new window"
- Die URL sieht z.B. so aus: https://dein-projekt.glitch.me

### Schritt 5: Quiz durchfuehren
1. Oeffne als Host: https://dein-projekt.glitch.me/host.html
2. Teilnehmende scannen den QR-Code oder oeffnen: https://dein-projekt.glitch.me
3. Klicke "Fragen eingeben" und gib deine 12 Fragen ein
4. Klicke "Quiz starten" - los geht's!

## Ablauf waehrend des Quiz
1. Du (Host) siehst die Frage mit Timer auf dem grossen Bildschirm
2. Teilnehmende sehen die Frage und Antwortoptionen auf ihrem Smartphone
3. Nach Ablauf des Timers wird die richtige Antwort angezeigt
4. Danach erscheint das Leaderboard (Top 10)
5. Klicke "Weiter" fuer die naechste Frage
6. Nach der letzten Frage: Sieger-Podium!

## Punktevergabe
- Richtige Antwort: 500 bis 1000 Punkte (je schneller, desto mehr)
- Falsche Antwort: 0 Punkte
- Keine Antwort: 0 Punkte
