# B2 VS Code Extension

Integrates Ventmere B2 into VS Code.

## Features

- Download B2 components and controllers to file system
- Upload after save
- Partial/Layout highlight/autocomplete
- Controller link/run
- Links to component/assets
- Asset Upload
- Page Explorer
- Preview component

## Requirements

- git

## Known Issues

## Release Notes

### 0.2.4

#### Added

- Added a command to sync local editing object's revision with B2.

### 0.2.3

#### Fixed

- Fixed run controller output always showing 'Loading...'

### 0.2.2

#### Added

- Added a command to tag content elements with UUID for translation.

### 0.2.1

#### Fixed

- Minor bug fixes

### 0.2.0

#### Added

- Auto complete in components and LESS files
- Run Controller command
- Insert Controller ID command
- Display controller name in \*.component.json
- Jump to Controller file
- Jump to LESS file

#### Fixed

- B2 Mustache language no longer applied to Angular component html files (Run `B2: Upgrade` command to rename your local files)

### 0.1.0

MVP Release

---

## Project Setup

- Create an empty project folder.
- `git init`, create a `.gitignore`/b2config.json`.
- Create a `b2config.json` with `endpoint` and `token`.
- Commit all local changes to git.
- Click `B2` icon, then click `B2: Pull Source Code` button.
- Wait pull to finish.

**Enjoy!**
