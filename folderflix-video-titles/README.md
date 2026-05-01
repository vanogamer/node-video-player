# FolderFlix

FolderFlix is a local Node.js video player that lets you select a folder from your computer, build a playlist from supported video files, continue watching from the last saved position, and delete videos directly from the player.

## GitHub Description

Local Node.js video player with folder picker, playlist restore, resume playback, deletion support, and player-log history.

## What It Does

- Adds only supported video files from a selected folder to the playlist.
- Ignores photos, HTML, CSS, JS, JSON, and other non-video files.
- Remembers the last selected folder, last watched video, and playback time.
- Restores the same playlist when reopened, if Chrome/Edge still grants folder permission.
- Adds a Delete button in the top controls for the current video.
- Adds a Delete button for each playlist item.
- Removes deleted videos from the playlist immediately.
- Automatically moves to the next video after deleting the current one.
- Includes a Remove Folder button that removes the folder from the playlist without deleting files from disk.
- Clears/deletes player-log.json after removing a folder so old playlist and progress state does not get mixed up.
- Saves lastWatched, lastDeleted, and deleted history inside player-log.json.

## Required Software

Install Node.js 18 or newer.

You can check your version with:

```bash
node -v
```

No extra npm packages are required. The server uses only built-in Node.js modules.

## How To Run

1. Open this project folder in CMD, PowerShell, Terminal, or VS Code Terminal.
2. Run:

```bash
npm start
```

Or double-click:

```text
start.bat
```

3. Open this URL in your browser:

```text
http://localhost:3000
```

4. Click **Folder** or **Choose Folder**.
5. Select the folder that contains your videos.

## Recommended Browser

Use Chrome or Microsoft Edge.

Direct folder selection and deleting files from disk require browser support for the File System Access API. Do not open the project with `file://`; run it through the Node server.

## Supported Video Extensions

```text
.mp4, .mkv, .webm, .mov, .m4v, .avi, .wmv, .flv, .ts, .m2ts, .3gp, .ogv
```

## Project Structure

```text
folderflix/
├─ server.js
├─ package.json
├─ start.bat
├─ README.md
├─ SETUP_AND_USAGE.txt
├─ GITHUB_README.txt
└─ public/
   ├─ index.html
   ├─ styles/
   │  └─ style.css
   └─ js/
      └─ script.js
```

## Important Warning

The Delete feature really deletes the selected video file from your disk. Use it carefully.
