# Running from a pendrive on another PC

Short answer: **yes, it will work** — search, all 11 speeches, 28 POIs, defences, dossiers,
procedure, notes, timers, the resolution editor and even semantic search all run with no internet
and nothing installed. Two things need setting up first.

---

## Do this once, on your own laptop

1. **Close the MUN server** if it is running (close the black window). Copying a database while it
   is being written to can corrupt it.

2. **Right-click `Prepare-USB.ps1` → Run with PowerShell.**
   It copies the app *and* your live data — notes, edited POIs, your resolution, and the 23 MB
   embedding model — onto the drive.

3. **Put Node.js on the drive.** This is the part that makes it run on a locked-down school PC:

   - Go to <https://nodejs.org/en/download>
   - Choose **Windows Binary (.zip)**, 64-bit — **not** the `.msi` installer
   - Unzip it, and copy the *contents* of `node-v24.x.x-win-x64` into a folder called `node`
     next to `MUN.cmd`, so that this exists:

     ```
     E:\MUN\node\node.exe
     ```

   No installation, no admin rights, nothing written to the school PC.

---

## On the school PC

Open the drive, double-click **`MUN.cmd`**. A black window opens, then your browser at
<http://127.0.0.1:8788>.

Leave the black window open while you work. Close it when you finish, then **eject the drive
safely** — it holds a live database.

---

## What works there, and what does not

| | |
|---|---|
| ✅ Search across all 11 documents | fully offline |
| ✅ Semantic search | the model is on the drive, no download needed |
| ✅ Speeches, POIs, defences, dossiers, procedure | offline |
| ✅ Notes, timers, bloc board, resolution editor, import/export | offline |
| ✅ Everything you edit | saved to the drive, comes home with you |
| ⚠️ Live transcription | needs internet and Chrome/Edge |
| ❌ AI analysis | see below |

### Why AI will not work there

The **subscription option needs Claude Code installed and logged in on that PC**, which the school
machine will not have. Two ways round it:

- **An API key works anywhere.** It is stored in the database on the drive, so if you set one up at
  home it travels with you and needs only internet at school. This is the only option that needs no
  software on the host PC.
- Installing Claude Code on a school PC means signing into your Anthropic account on a shared
  machine. If you do, run `/logout` before you leave — and prefer the API key.

Everything that makes this tool useful in committee — finding your own prepared material in
milliseconds — works with no AI at all.

---

## Your data lives on the drive

`MUN.cmd` sets the data folder to `MUN-Data` on the pendrive itself. Nothing is written to the host
computer: no database, no notes, no transcript. Your work travels with the drive and leaves nothing
behind on a school machine.

To bring changes home, either work from the pendrive on your laptop too, or copy `MUN-Data` back
over `%LOCALAPPDATA%\mun-command-center`.

---

## If it will not start

| | |
|---|---|
| *"Node.js was not found"* | Step 3 above — the portable `.zip`, not the installer. |
| Windows blocks `MUN.cmd` | School policy may block programs on removable drives. Copy the whole `MUN` folder to the Desktop and run it from there instead. |
| *"The user interface has not been built"* | On your laptop run `cd app` then `npm run build`, and copy across again. |
| Port 8788 already in use | Something else is on that port. Edit `MUN.cmd` and add `set PORT=8899` near the top. |
| Search returns nothing, library is empty | You started with a fresh `MUN-Data` folder. Either re-run `Prepare-USB.ps1` from your laptop to bring your data across, or click **Research → Import documents** — the source files are on the drive, so this works offline. |
| Very slow to start | USB 2 ports are slow with 570 MB of files. Copying the folder to the PC's Desktop makes it much faster. |
| Antivirus warns about the folder | It is scanning 570 MB of JavaScript for the first time. Let it finish once. |

---

## Before the competition

Do a full rehearsal from the pendrive on a *different* PC, at least a day before the 14th. Confirm
the browser opens, search returns results, and your speeches are all there. A pendrive that has
never been tested on another machine is not a backup.
