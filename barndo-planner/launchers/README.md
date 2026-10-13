# Desktop launchers

Copy the file for your system onto your desktop and double-click it. The first run
downloads the code into `BarndoPlanner` in your home folder and installs the
dependencies, which needs an internet connection and takes about a minute. After
that it starts in a few seconds and opens the app in your browser.

| System | File | Notes |
| --- | --- | --- |
| Windows | `Barndo Planner.bat` | Installs Node.js with winget if it is missing. Uses Git if installed, otherwise downloads a ZIP. |
| macOS | `Barndo Planner.command` | Run `chmod +x "Barndo Planner.command"` once if Finder says it can't be opened. If Gatekeeper blocks it, right-click → Open. |
| Linux | `barndo-planner.sh` | Run `chmod +x barndo-planner.sh`, then double-click (choose "Run in terminal") or run `./barndo-planner.sh`. |

Keep the terminal window open while using the app. Closing it stops the local server.

To fetch the latest code, run the launcher with `update` as an argument (for example
`"Barndo Planner.bat" update`), or delete the `BarndoPlanner` folder in your home directory.

The repository, branch and sub-folder are set at the top of each script. When the
project moves to its own repository, change `REPO` and `BRANCH` and set `SUBDIR` empty.
