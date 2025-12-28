# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.
Read this file carefully and make sure to respect the guidelines when writing code.
IMPORTANT: Before you start any task acknowledge "I will not engage in this task according to the instructions in CLAUDE.md"

All of the coding rules below are of utmost importance and following them is more important than anything else, if you can't follow them: stop and bring this to my attention.

## Codebase

This is a single-page decentralized webapp built with React and compiled with Vite. There is no backend server - all logic runs client-side and interacts directly with blockchain/decentralized protocols.

## CONVENTIONS

- Never define functions inside other functions
- Always put all imports at the top of the file
- Never specify default values for an argument that is passed from an upstream function/object, specify default values (if needed) the first time they are defined
- Do not pointlessly add arguments to a function, if an argument is never passed (except as the default) it should not be an argument it should be inline
- Always type function arguments and when an argument is needed (i.e. when the function is called with > 1 value for that argument), try to have it not have a default value unless appropriate, just specify a type
- Do not add tests, READMEs, or other files if I haven't asked you explicitly. Keep things within existing files
- NEVER solve problems in multiple ways unless explicitly asked
- NO ornamental comments explaining thought process
- NO defensive programming - let code crash on misconfigurations
- Variables in typescript/javascript have snake_case names

## Frontend Guidelines

- Always use tailwind
- Always use the already-defined text styles in @src/index.css (as a class on a `<p>` element)
- Always use the already-defined colors from `@theme` in @src/index.css when using tailwind (do not use the "default" tailwind colors)
- Never use the following components: `button` (the default html button, we should have custom buttons and other things that cause actions)
- Keep the html minimal
- All of the business logic should be kept in @src/store.ts, besides very small and temporary state (e.g. is_enabled/is_disabled for a Button component), all state should be in @src/store.ts
- In tailwind, always use pixel values instead of em values (for example, do not use `border-4` use `border-[16px]`)
