/*
Purpose:
    - To find keys and values used for translations
    - Merge with any previously found keys without values (found in 'find-i18n-keys' step)
    - Write those keys/values to a default (base language, en) json file.

A later task will take all those keys and values and translate them
*/


import gulp from 'gulp';
import project from '../aurelia.json';
import through from 'through2';
import fs from 'fs';
import mkdirp from 'mkdirp';
import path from 'path';

import jsdom from 'jsdom';
// import sync from 'i18next-json-sync';
import deep from 'deep-diff';

import findi18nKeys from './find-i18n-keys';
import translateLocales from './translate-locales';

let allLocales = {};
let mismatchedLocaleLog = [];

let localeFiles = project.localeProcessor.source;
let relativeLocaleFiles = '../../' + localeFiles; //Moving up two directories due to command being run in tasks folder

let languages = project.localeProcessor.languages;
let primaryLanguage = languages[0];

function getLocationOfTranslationKeys(locale, namespace) {
    //Set this to define where you stored your previously found keys (from find i18n keys step)
    return  `../../locales/${locale}/toTranslate_${namespace}.json`;
}
function getLocationOfExistingLocales(locale, namespace) {
    //Set this to define where you stored your previously created locales
    return `../../locales/${locale}/${namespace}.json`;
}

export default gulp.series(
    findi18nKeys, //Used as an initial setting for keys. If we have any mismatch with getting the actual phrases, we need to notify
    getPhrasesToTranslate, //Get's the words inside the elements that contain the i18n attribute. Used for automatic translation.
    writeToLocaleFiles, //Write out our phrases to the Locale file
    translateLocales, //Translate the English Locale file to all the others
    //syncLocales
);

// export function syncLocales() {
//     //Since we're basing everything off of the EN Locale, this should be redundant. However, if we were to change just one locale, we want a means to check for differences
//     return sync({
//         files: relativeLocaleFiles, //'../../locales/**/*.json',
//         primary: 'en'
//     });
// }

//Executions
function getPhrasesToTranslate() {
    return gulp.src(project.localeProcessor.translateFiles)
        .pipe(through.obj((file, enc, cb) => {
            if (path.extname(file.path) === '.js') {
                //Don't have a way to get translation from javascript files, will have to manually add those
                //Going to leave the default value in place from the find keys step (default value is __NEEDS_TRANSLATION__)
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
                        let namespacedKeyStore = {};

                        let templateInstance = createElementFromTemplatesOnWindow(window);
                        if (!templateInstance) {
                            // No template tag to search inside. Skipping
                            // TODO: Future, allow some kind of searching without needing template tags
                            //      Right now we use template tags to make sure we're only translating code we wrote in Aurelia (which uses template tags)
                            console.log('Not searching file for translation phrases:');
                            console.log(file.path);
                            resolve();
                            return;
                        }

                        //Strange bug with querySelectorAll and passing multiple selectors. So we're going to make two seperate calls
                        let i18nElements = window.document.querySelectorAll('[i18n]');
                        //let tElements = window.document.querySelectorAll('[t]'); //Until the github issue is resolved, we can't query attributes with single characters
                        let elementsToTranslate = Array.from(i18nElements);//.concat(Array.from(tElements));

                        if (elementsToTranslate.length > 0) {
                            getKeysToTranslateOffElements(elementsToTranslate, namespacedKeyStore);
                        }
                        mergeNewTranslationsWithExisting(namespacedKeyStore);
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
    //Only write default json file, translation task will write to appropriate files
    let localeFileWrites = [];
    //for (let locale in allLocales) {
    let fileWritePromise = new Promise((resolve, reject) => {
        for (let namespace in allLocales[primaryLanguage]) {
            let sortedLocaleObject = sortJSON(allLocales[primaryLanguage][namespace]);
            fs.writeFile(`locales/${primaryLanguage}/${namespace}.json`, JSON.stringify(sortedLocaleObject, null, '\t'), () => {
                resolve();
            });
        }
    });
    localeFileWrites.push(fileWritePromise);
    //}
    return Promise.all(localeFileWrites)
        .then(() => {
            if (mismatchedLocaleLog.length === 0) {
                return;
            }
            //If we have any mismatched logs, go ahead and write them out
            let timestamp = new Date().toISOString().replace(/:/g, '_').split('.');
            timestamp.splice(-1, 1);
            timestamp.join('.');
            return fs.writeFile('locales/MismatchLog-' + timestamp + '.txt', 'Diff by https://github.com/flitbit/diff \n' + JSON.stringify(mismatchedLocaleLog || [], null, '\t'), cb);
        });
}

/////////////////////////
////Utility functions////
/////////////////////////

//Makes use of global allLocales to store all the locale info
// If the key isn't used/found in use, then any unused key will be removed
function mergeNewTranslationsWithExisting(namespacedKeyStore) {
    //Loop through each top level namespace
    for (let namespace in namespacedKeyStore) {
        //get the locale file to translate for each needed translation
        let toTranslatePath = getLocationOfTranslationKeys(primaryLanguage, namespace); //`../../locales/${locale}/toTranslate_${namespace}.json`;
        let existingLocalePath = getLocationOfExistingLocales(primaryLanguage, namespace); //`../../locales/${locale}/${namespace}.json`;

        let toTranslateLocaleFile = {}; //This will be what will build the master list
        //get/create locale file to use for locales to translate
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

        let existingLocaleFile = {}; //This is just used for comparison to what has changed
        //get/create locale file to use for existing locales
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
        allLocales[primaryLanguage] = allLocales[primaryLanguage] || {};
        allLocales[primaryLanguage][namespace] = allLocales[primaryLanguage][namespace] || {};

        let previouslyFoundLocales = JSON.parse(JSON.stringify(existingLocaleFile)); //Clone object for comparison

        // Extend the allLocales (which will contain the final translations) with the translations that need to be translated (namespacedKeys[namespace])
        // Take what we currently have (allLocales),
        //      merge with any new keys found (toTranslateLocaleFile),
        //      WILL NOT merge with any existing translations (existingLocaleFile), (THIS IS BECAUSE IF IT WAS NOT A FOUND KEY, WE WILL NOT NEED IT, server keys should be in a different namespace)
        //      ^^ But we still need to keep any previous translations
        //      then merge in our newly found key/values (namespacedKeyStore)
        // If a key has a previous value, and the new value is "__NEEDS_TRANSLATION__", then use the old value.
        deepExtend(allLocales[primaryLanguage][namespace], toTranslateLocaleFile, existingLocaleFile, namespacedKeyStore[namespace], (a, b) => {
            if (!a || a === '__NEEDS_TRANSLATION__') { //Only overwrite if previous value needed translation
                return b;
            }
            return a;
        });
        // TODO: only trim away if we haven't detected any dynamic portion of a key
        // Now trim away any translations that aren't being used
        //traverse(allLocales[primaryLanguage][namespace], function(key, value, dotKey, parent) {
        //    if (!getPropFromDot(toTranslateLocaleFile, dotKey)) {
        //        delete parent[key];
        //    }
        //});

        //Compare existing (primaryLanguage) english (since it's what we use as our base translation) locale with the new one to find any changes to log
        findMismatchedLocales(previouslyFoundLocales, allLocales[primaryLanguage][namespace]);
    }
    return allLocales;
}
function setTranslationKey(key, value, keys, originalKey) { // "home.title.foo", "title.foo", "foo"
    //Used to set the translation key deep in the locale object
    originalKey = originalKey || key;
    let keyParts = key.split('.');
    if (keyParts.length === 1) { //End of the line
        if (keys[key] && keys[key] !== value) {
            console.log('\x1b[47m\x1b[47m%s\x1b[0m', `Duplicate translation key found with mismatched values. Last in wins.\n  - Key:${originalKey}\n  - original: ${keys[key]}\n  - new: ${value}`);
        }
        return keys[key] = value;
    }

    if (!keys[keyParts[0]]) {
        keys[keyParts[0]] = {};
    }
    setTranslationKey(keyParts.slice(1, keyParts.length).join('.'), value, keys[keyParts[0]], originalKey);
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
function getKeysToTranslateOffElements(elementsToTranslate, namespacedKeyStore) {
    for (let elem of elementsToTranslate) {
        let i18nKey = elem.getAttribute('i18n');
        let tKey = elem.getAttribute('t');
        let translationKey = tKey || i18nKey;
        let translationKeys = translationKey.split(';'); // There can be multiple i18n commands, they're split by a semi-colon

        translationKeys.forEach(key => {
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
                //We have a namespace we need to consider
                namespacedKeyStore[namespacedKey[0]] = namespacedKeyStore[namespacedKey[0]] || {}; //Initialize store with namespace if we don't have one
                setTranslationKey(namespacedKey[1], currentElemText, namespacedKeyStore[namespacedKey[0]]);
            } else {
                //Use the default namespace as one wasn't defined
                namespacedKeyStore.translation = namespacedKeyStore.translation || {}; //translation is default namespace
                setTranslationKey(key, currentElemText, namespacedKeyStore.translation);
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
function sortJSON(obj) {
    let sortedObject = {};

    Object.keys(obj).sort().forEach(function(key) {
        if (typeof obj[key] === 'object') {
            obj[key] = sortJSON(obj[key]);
        }
        sortedObject[key] = obj[key];
    });

    return sortedObject;
}
function traverse(obj, func, passedDotKey = '') {
    for (let key in obj) {
        let dotKey = passedDotKey.length === 0 ? (passedDotKey + `${key}`) : (passedDotKey + `.${key}`);
        func.apply(this, [key, obj[key], dotKey, obj]);
        if (obj[key] !== null && typeof(obj[key]) === 'object') {
            //going on step down in the object tree!!
            traverse(obj[key], func, dotKey);
        }
    }
}
function getPropFromDot(obj, dot) {
    return dot.split('.').reduce((a, b) => a[b], obj);
}
