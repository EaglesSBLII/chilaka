# Installing Chilaka on a Mac 🦜

Chilaka is a free app that isn't on the App Store, so macOS asks you to approve it
once the first time. It takes about 30 seconds. **You only do this once per version.**

> Chilaka needs an **Apple Silicon Mac** (M1/M2/M3/M4) running macOS 12 or newer.

## 1. Install

1. Double-click **`Chilaka-0.1.0-arm64.dmg`**.
2. In the window that opens, **drag the Chilaka parrot onto the Applications folder.**
3. Eject the disk image (drag it to the Trash / click ⏏).

## 2. First open (the "Open Anyway" step)

Because Chilaka isn't signed with a paid Apple developer account, the first launch
is blocked by macOS Gatekeeper. To allow it:

1. Open **Applications** and double-click **Chilaka**.
2. You'll see *"Apple could not verify Chilaka is free of malware."* Click **Done**.
3. Open  → **System Settings** → **Privacy & Security**.
4. Scroll down to the **Security** section. You'll see:
   *"Chilaka was blocked to protect your Mac."* Click **Open Anyway**.
5. Confirm with **Open Anyway**, then enter your Mac password / Touch ID.
6. Chilaka launches. **From now on it opens normally** by double-clicking.

### Faster way (if you're comfortable with Terminal)

```bash
xattr -dr com.apple.quarantine /Applications/Chilaka.app
```

Then just double-click Chilaka — no dialogs.

## 3. Grant the microphone (for speaking practice)

The first time you do a **Speak** exercise, macOS asks for microphone access —
click **Allow**. If you miss it: System Settings → Privacy & Security → Microphone →
turn on **Chilaka**. (Your audio is analyzed entirely on your Mac and never uploaded.)

## 4. Turn on reminders (optional)

Open **Settings** in Chilaka → **Daily reminders** → set your times → **Save**.
Right-click the parrot in your **menu bar** and enable **Start at login** so reminders
fire even when the window is closed. When a reminder shows a notification, allow
notifications for Chilaka if macOS asks.

---

## Sharing Chilaka with family

Just **AirDrop them the `.dmg` file** (and this page). They follow the same steps
above. Everyone's progress is separate and stored on their own Mac.

To move *your* progress to another Mac or your iPhone: in **Settings → Backup & sync**,
tap **Export backup**, AirDrop the file over, and **Import backup** on the other device.

## Troubleshooting

| Problem | Fix |
|---|---|
| *"Chilaka is damaged and can't be opened"* | Run `xattr -dr com.apple.quarantine /Applications/Chilaka.app` in Terminal. This happens when the .dmg loses its "downloaded" tag during transfer. |
| Speaking exercise says the mic is unavailable | System Settings → Privacy & Security → Microphone → enable Chilaka, then restart the app. |
| Reminders don't fire | Keep Chilaka running (it hides to the menu bar when you close the window — quit only via the menu-bar parrot → Quit). Enable **Start at login**. |
| App won't open on an Intel Mac | Chilaka is Apple-Silicon only. |
