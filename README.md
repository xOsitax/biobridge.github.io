# BioBridge

**Biometric Login, Reimagined**

BioBridge is a university project and Chrome browser extension prototype that explores biometric-inspired authentication for website logins. The project focuses on reducing password fatigue, improving login usability, and supporting user trust through a recovery email fallback system and a companion website with research and survey findings.

## About the Project

BioBridge is a Chrome extension prototype designed to demonstrate how biometric-inspired login workflows could improve the way users access websites.

The project includes:

- A Chrome extension popup interface
- A simulated biometric authentication workflow
- A recovery email fallback system
- A website login support concept
- A companion website / research page
- Survey-informed design decisions

BioBridge was developed for academic and research purposes as part of a university project. It is **not production-ready security software** and should not be used as a real password manager or secure authentication system.

## Features

- Chrome extension popup UI
- Authentication workflow simulation
- Recovery email fallback
- Website login support concept
- Companion website / research page
- Survey-informed design
- Prototype-focused security and usability exploration

## Manual Installation Guide

The Chrome Web Store publication process may take several days because extensions must go through review. While waiting for review, users and testers can manually download and load BioBridge in Chrome using Developer Mode.

### Steps

1. Go to the BioBridge GitHub repository.
2. Click the green **Code** button.
3. Click **Download ZIP**.
4. Extract or unzip the downloaded folder.
5. Open Google Chrome.
6. Go to `chrome://extensions`.
7. Enable **Developer Mode** using the toggle in the top-right corner.
8. Click **Load unpacked**.
9. Select the extracted BioBridge extension folder that directly contains `manifest.json`.
10. Pin the extension using the puzzle icon in the Chrome toolbar.
11. Click the BioBridge icon to test the extension.

## Screenshot Placeholders

Use the following images to document the manual installation process:

![Step 1 - Download ZIP](images/download-zip.png)

![Step 2 - Extract Folder](images/extract-folder.png)

![Step 3 - Chrome Extensions Page](images/chrome-extensions.png)

![Step 4 - Enable Developer Mode](images/developer-mode.png)

![Step 5 - Load Unpacked](images/load-unpacked.png)

![Step 6 - Select Folder](images/select-folder.png)

![Step 7 - Extension Loaded](images/extension-loaded.png)

![Step 8 - BioBridge Popup](images/biobridge-popup.png)

## Troubleshooting

### "Manifest file is missing or unreadable"

**Fix:** Make sure you select the folder that directly contains `manifest.json`. Do not select the parent folder if `manifest.json` is inside another nested folder.

### Extension does not appear

**Fix:** Refresh `chrome://extensions`, then try loading the unpacked extension again. You can also click the reload icon on the BioBridge extension card.

### Popup does not open

**Fix:** Check for extension errors on `chrome://extensions`. Reload the extension, then click the BioBridge icon again.

### Buttons do not work

**Fix:** Make sure all JavaScript files are included in the extension folder. Reload the unpacked extension after confirming the files are present.

## Project Structure

Example project structure:

```text
BioBridge/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── content.js
├── icons/
└── images/
```

Depending on the final repository organization, files may also be grouped into folders such as `popup/`, `background/`, `content/`, and `assets/`.

## Companion Website

BioBridge also includes a companion website that presents project information, research context, and survey findings.

Website: <https://xositax.github.io/biobridge.github.io/>

## Academic Disclaimer

BioBridge is a prototype created for learning, research, and demonstration purposes. It explores authentication ideas and user experience considerations, but it does not provide production-grade biometric authentication, password storage, encryption, or account protection.

## Authors

Created by **Yessenia** and **Jawad** as part of a university project.
