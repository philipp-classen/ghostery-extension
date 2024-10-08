# Ghostery DNR Extension

Ghostery helps you browse smarter by giving you control over ads and tracking technologies to speed up page loads, eliminate clutter, and protect your data.

## Local development

First, you need to install JavaScript dependencies and download additional resources (e.g. block lists):

```bash
cd .. && npm ci
```

Now everything is ready. Change the code, and run it in Chrome:

```bash
npm start
```

To develop the extension for a different target, add the target name after the command:

* Firefox - `npm start firefox`
* Safari (MacOS) - `npm start safari-macos`
* Safari (iOS) - `npm start safari-ios`

> The build script assumes that you are using macOS, and browsers are installed in the default locations.

However, to test it in Safari browser, you will have to use Xcode. The project files are available in the `xcode` folder, but Apple's ecosystem is more complex. Fortunately, most changes can be tested reliably in Chrome.

You can also specify the browser to use, for the `chromium` target:

* Opera - `npm start -- --browser=opera`
* Edge - `npm start -- --browser=edge`

If you want to contribute, try to get it working in Chrome. Most of the time, your code will work in Safari, too.

## Building

If you need to build the extension, use the following build command:

```bash
npm run build [target="chromium"]
```

## Locales

Use the [Transifex client](https://docs.transifex.com/client/introduction) to push the new translations to the server. Use the following steps:

1. `npm run locales` for updating the web extension part
2. `npm run xcode-export-locales` for generating the `en.xliff` file
3. `tx push` to upload the updated source files to the Transifex

For pulling translated messages, run `tx pull`. However, for the native part, open the project in Xcode, and use the `Import Localizations` feature with the resources directly downloaded from Transifex.
