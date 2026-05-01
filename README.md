# Local Folder Video Player

Local Folder Video Player is a lightweight Node.js web player for watching videos directly from a folder on your computer. It creates a playlist from the selected folder, remembers your last watched video and playback time, supports video deletion, and stores player history in `player-log.json`.

## GitHub Description

Local Node.js video player with folder picker, playlist restore, resume playback, deletion support, and player-log history.

## Requirements

- Node.js 18 or newer
- npm
- Google Chrome or Microsoft Edge recommended

## Installation

Clone or download the project, then open the project folder in CMD or Terminal.

```bash
npm install
```

This project currently uses Node.js built-in modules for the server, but running `npm install` is safe and useful when `package.json` is included.

## Run

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

On Windows, you can also double-click `start.bat` if it is included.

## How to Use

1. Open `http://localhost:3000` in Chrome or Edge.
2. Click **Folder** or **Choose Folder** in the player.
3. Select the folder that contains your videos.
4. Watch videos from the generated playlist.
5. Use **Delete** to remove the current video or a playlist item.
6. Use **Remove Folder** to clear the playlist without deleting the folder from disk.

## Features

- Folder picker for local video folders
- Automatic playlist creation
- Only supported video files are added to the playlist
- Non-video files are ignored
- Resume playback from the last watched video and time
- Playlist restore when reopening the player
- Current video delete button
- Playlist item delete buttons
- Automatic move to the next video after deletion
- `player-log.json` history file
- Last watched video tracking
- Deleted video history
- Folder removal history
- Folder removal without deleting the actual folder from disk
- Log reset after folder removal to avoid mixed old playlist state

## Supported Video Extensions

```text
.mp4, .mkv, .webm, .mov, .m4v, .avi, .wmv, .flv, .ts, .m2ts, .3gp, .ogv
```

## player-log.json

The project can create a `player-log.json` file automatically. It stores:

- `lastWatched` - the last watched video and playback time
- `lastDeleted` - the last deleted video
- `deleted` - deleted video history
- `lastFolderRemoved` - the last removed folder record
- `folderRemoved` - folder removal history

## Important Notes

- Do not open the project with `file://`.
- Always run the Node.js server and use `http://localhost:3000`.
- Folder selection and disk deletion work best in Chrome and Edge on localhost.
- The **Delete** action really deletes the video file from your disk.
- Be careful before deleting videos.

## License

This project is private by default. Add your preferred license if you want to publish it publicly.
