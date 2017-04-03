import gulp from 'gulp';
import project from '../aurelia.json';
import through from 'through2';
import fs from 'fs';
import mkdirp from 'mkdirp';
import path from 'path';

import jsdom from 'jsdom';
import sync from 'i18next-json-sync';
import deep from 'deep-diff';
import translate from 'google-translate-api';

import processi18n from './process-i18n';

let allLocales = {};
let mismatchedLocaleLog = [];

export default gulp.series(
    processi18n, //Used as an initial setting for keys. If we have any mismatch with getting the actual phrases, we need to notify
    getPhrases, //Get's the words inside the elements that contain the i18n attribute. Used for automatic translation.
    writeToLocaleFiles, //Write out our phrases to the Locale file
    translateLocales, //Translate the English Locale file to all the others
    //syncLocales
);

export function syncLocales() {
    //Since we're basing everything off of the EN Locale, this should be redundant. However, if we were to change just one locale, we want a means to check for differences
    return sync({
        files: '../../locales/**/*.json',
        primary: 'en'
    });
}

//Executions
function getPhrases() {
    return gulp.src(project.localeProcessor.translate)
        .pipe(through.obj((file, enc, cb) => {
            if (path.extname(file.path) === '.js') { //Don't have a way to get translation from javascript files, will have to manually add those
                return cb(null, file);
            }
            let promise = new Promise((resolve, reject) => { //Going to "load"/"render" the DOM so we can easily strip out the initial translations
                jsdom.env(
                    `<html><body>${file.contents.toString()}</body></html>`, //Wrapping in html/body for fragments to be loaded
                    function(err, window) {
                        if (err) {
                            console.log('Trouble making the window for scraping');
                            console.log(err);
                        }
                        let namespacedKeys = {};

                        let templateInstance = createElementFromTemplatesOnWindow(window);
                        if (!templateInstance) {
                            console.log('Not searching file for translation phrases:');
                            console.log(file.path);
                            resolve();
                            return;
                        }

                        //Strange bug with querySelectorAll and passing multiple selectors. So we're going to make two seperate calls
                        let i18nElements = window.document.querySelectorAll('[i18n]');
                        //let tElements = window.document.querySelectorAll('[t]');
                        let elementsToTranslate = Array.from(i18nElements);//.concat(Array.from(tElements));

                        if (elementsToTranslate.length > 0) {
                            stripKeysToTranslate(elementsToTranslate, namespacedKeys);
                        }
                        addTextToTranslationFiles(namespacedKeys);
                        window.close(); //Helps with memory collection
                        resolve();
                    });
            });
            return promise.then(() => {
                cb(null, file);
            });
        }));
}
function writeToLocaleFiles(cb) {
    //Writes new locale info to source local folder
    let localeFileWrites = [];
    for (let locale in allLocales) {
        let fileWritePromise = new Promise((resolve, reject) => {
            for (let namespace in allLocales[locale]) {
                fs.writeFile(`locales/${locale}/${namespace}.json`, JSON.stringify(allLocales[locale][namespace], null, '\t'), () => {
                    resolve();
                });
            }
        });
        localeFileWrites.push(fileWritePromise);
    }
    return Promise.all(localeFileWrites)
        .then(() => {
            if (mismatchedLocaleLog.length === 0) {
                return;
            }
            //If we have any mismatched logs, go ahead and write them out
            let timestamp = new Date().toISOString().replace(/:/g, '_').split('.');
            timestamp.splice(-1, 1);
            timestamp.join('.');
            return fs.writeFile('locales/MismatchLog-' + timestamp + '.json', 'Diff by https://github.com/flitbit/diff \n' + JSON.stringify(mismatchedLocaleLog || [], null, '\t'), cb);
        });
}
export function translateLocales() {
    //Translates locale info and writes translations to source and output locales
    return gulp.src(project.localeProcessor.source)
        .pipe(through.obj((file, enc, cb) => {
            let translationRequests = [];
            console.log('translating file: ' + file.path);
            let localeTranslation = JSON.parse(file.contents.toString());
            let locale = file.dirname.replace(/\\/g, '/').split('/').pop();
            console.log('translating to: ' + locale);
            let namespace = path.basename(file.path, '.json');
            //If not english, translate
            if (locale !== 'en' && locale !== 'gb') {
                //Go through each property and translate
                traverse(localeTranslation, function(key, value, dotKey) { //TODO: `value` here is only a copy to the original. Would be much better if it were a reference
                    if (typeof value === 'string') {
                        if (value !== '__NEEDS_TRANSLATION__') {
                            translationRequests.push(
                                translate(value, {from: 'en', to: locale}).then(res => {
                                    //localeTranslation[key] = res.text;
                                    setTranslationKey(dotKey, res.text, localeTranslation, true);
                                }).catch(err => {
                                    console.error(err);
                                })
                            );
                        } else {
                            //Can we look at the english version to translate?
                            //At this point, we already know our namespace by the file location
                            //let namespaces = dotKey.split(':');

                            let englishTranslation = getPropFromDot(allLocales['en'], `${namespace}.${dotKey}`);//enLocale, dotKey);
                            if (englishTranslation) {
                                translationRequests.push(
                                    translate(englishTranslation, {from: 'en', to: locale}).then(res => {
                                        //localeTranslation[key] = res.text;
                                        setTranslationKey(dotKey, res.text, localeTranslation, true);
                                    }).catch(err => {
                                        console.error(err);
                                    })
                                );
                            }
                        }
                    }
                });
            }

            Promise.all(translationRequests)
                .then(() => {
                    file.contents = new Buffer(JSON.stringify(localeTranslation, null, '\t'));
                    cb(null, file);
                });
        }))
        .pipe(gulp.dest('locales/'))
        .pipe(gulp.dest(project.localeProcessor.output));
}

//Utility functions
function addTextToTranslationFiles(namespacedKeys) {
    //Loop through each top level namespace
    for (let namespace in namespacedKeys) {
        //get the locale file to translate for each needed translation
        for (let locale of project.localeProcessor.languages) {
            let toTranslatePath = `../../locales/${locale}/toTranslate_${namespace}.json`;
            let existingLocalePath = `../../locales/${locale}/${namespace}.json`;

            let toTranslateLocaleFile = {};
            if (fs.existsSync(path.resolve(__dirname, toTranslatePath))) {
                toTranslateLocaleFile = require(toTranslatePath);
            } else {
                //create file
                try {
                    mkdirp(path.dirname(toTranslatePath), (err) => {
                        if (err) {
                            console.log(err);
                        }
                        fs.writeFileSync(toTranslatePath, JSON.stringify(toTranslateLocaleFile));
                    });
                } catch (e) {
                    console.log(e);
                }
            }

            let existingLocaleFile = {};
            if (fs.existsSync(path.resolve(__dirname, existingLocalePath))) {
                existingLocaleFile = require(existingLocalePath);
            } else {
                //create file
                try {
                    mkdirp(path.dirname(existingLocalePath), (err) => {
                        if (err) {
                            console.log(err);
                        }
                        fs.writeFileSync(existingLocalePath, JSON.stringify(existingLocaleFile));
                    });
                } catch (e) {
                    console.log(e);
                }
            }

            //Initialize location for translation
            allLocales[locale] = allLocales[locale] || {};
            allLocales[locale][namespace] = allLocales[locale][namespace] || {};

            let previouslyFoundLocales = JSON.parse(JSON.stringify(existingLocaleFile)); //Clone object for comparison
            //Extend the allLocales (which will contain the final translations) with the translations that need to be translated (namespacedKeys[namespace])
            //TODO: If the value is needing translation, look at the original to see if we can't re-use a translation
            //DeepExtend(CurrentlyFoundLocales, ToTranslateLocales, ExistingTranslations, NewlyFoundLocales)
            deepExtend(allLocales[locale][namespace], toTranslateLocaleFile, existingLocaleFile, namespacedKeys[namespace], (a, b) => {
                if (!a || a === '__NEEDS_TRANSLATION__') { //Only overwrite if previous value needed translation
                    return b;
                }
                return a;
            });

            //Compare existing english (since it's what we use as our base translation) locale with the new one to find any changes to log
            if (locale === 'en') {
                findMismatchedLocales(previouslyFoundLocales, allLocales[locale][namespace]);
            }
        }
    }
}
function setTranslationKey(key, value, keys, silent = false) { // "home.title.foo", "title.foo", "foo"
    //Used to set the translation key deep in the locale object
    let keyParts = key.split('.');
    if (keyParts.length === 1) { //End of the line
        if (keys[key] && !silent) {
            console.log(`Duplicate translation key (${key}) found. Last in wins.`);
        }
        return keys[key] = value;
    }

    if (!keys[keyParts[0]]) {
        keys[keyParts[0]] = {};
    }
    setTranslationKey(keyParts.slice(1, keyParts.length).join('.'), value, keys[keyParts[0]], silent);
}
function deepExtend(out) {
    out = out || {};
    let compFunc;
    if (typeof arguments[arguments.length - 1] === 'function') {
        compFunc = arguments[arguments.length - 1];
    }

    for (let i = 1; i < arguments.length; i++) {
        let obj = arguments[i];

        if (!obj || typeof obj === 'function') {
            continue;
        }

        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                if (typeof obj[key] === 'object') {
                    out[key] = deepExtend(out[key], obj[key], compFunc);
                } else {
                    if (out[key]) {
                        //console.log(`Duplicate translation key (${key}) found while extending. Last in wins.`);
                    }
                    if (compFunc) {
                        out[key] = compFunc(out[key], obj[key]);
                    } else {
                        out[key] = obj[key];
                    }
                }
            }
        }
    }

    return out;
}
function traverse(obj, func, passedDotKey = '') {
    for (let key in obj) {
        let dotKey = passedDotKey.length === 0 ? (passedDotKey + `${key}`) : (passedDotKey + `.${key}`);
        func.apply(this, [key, obj[key], dotKey]);
        if (obj[key] !== null && typeof(obj[key]) === 'object') {
            //going on step down in the object tree!!
            traverse(obj[key], func, dotKey);
        }
    }
}
function getPropFromDot(obj, dot) {
    return dot.split('.').reduce((a, b) => a[b], obj);
}
function createElementFromTemplatesOnWindow(window) {
    //Create "Template" in body
    let t = window.document.querySelector('template');
    if (!t) { //Nothing to look at here.
        return;
    }
    let tInstance = window.document.importNode(t.content, true);
    window.document.body.appendChild(tInstance);
    return tInstance;
}
function stripKeysToTranslate(elementsToTranslate, namespacedKeys) {
    for (let elem of elementsToTranslate) {
        let i18nKey = elem.getAttribute('i18n');
        let tKey = elem.getAttribute('t');
        let translationKey = tKey || i18nKey;
        let translationKeys = translationKey.split(';');

        translationKeys.forEach(key => {
            //TODO: Also need to check for namespacing separators (":")


            //If we have an `[html]` modifier, then lets get the innerHTML
            //Types:
            // [text]: Sets the textContent property (default)
            // [html]: Sets the innerHTML property
            // [append]: appends the translation to the current content already present in the element (allows html).
            // [prepend]: prepends the translation to the current content already present in the element (allows html).
            //Additional Types:
            // [placeholder]: Sets the placeholder property
            // .. And more...
            let currentElemText;

            let modifierRegex = /\[([^)]+)\]/;
            let modifierType = modifierRegex.exec(key);

            if (modifierType && modifierType[1] !== 'text') {
                switch (modifierType[1]) {
                    case 'placeholder':
                        currentElemText = elem.getAttribute('placeholder');
                        key = key.replace(modifierRegex, '');
                        break;
                    case 'title':
                        currentElemText = elem.getAttribute('title');
                        key = key.replace(modifierRegex, '');
                        break;
                    case 'label': //Not a valid attribute turns out
                        console.log('Label attribute incorrectly being used... ' + file.path);
                        currentElemText = elem.getAttribute('label');
                        key = key.replace(modifierRegex, '');
                        break;
                    default:
                        currentElemText = elem.innerHTML.trim();
                        key = key.replace(modifierRegex, '');
                }
            } else {
                currentElemText = elem.textContent;
            }

            let namespacedKey = key.split(':');
            if (namespacedKey.length > 1) {
                namespacedKeys[namespacedKey[0]] = namespacedKeys[namespacedKey[0]] || {};
                setTranslationKey(namespacedKey[1], currentElemText, namespacedKeys[namespacedKey[0]]);
            } else {
                namespacedKeys.translation = namespacedKeys.translation || {}; //translation is default namespace
                setTranslationKey(key, currentElemText, namespacedKeys.translation);
            }
        });
    }
}
function findMismatchedLocales(oldLocale, newLocale) {
    let diff = deep.diff(oldLocale, newLocale);
    if (!diff || JSON.stringify(mismatchedLocaleLog).indexOf(JSON.stringify(diff)) > -1) { //If no diff, or we already logged the diff 
        //TODO: I don't like how I'm doing this comparison. Not sure exactly how I want to check for matching complex objects
        return;
    }
    mismatchedLocaleLog = mismatchedLocaleLog.concat(diff || []);
}
