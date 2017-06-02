import gulp from 'gulp';
import project from '../aurelia.json';
import through from 'through2';
import path from 'path';
import fs from 'fs';
//import sync from 'i18next-json-sync';

import translate from 'google-translate-api';
// import MsTranslator from 'mstranslator';

let translationFiles = project.localeProcessor.source;
let translationFilesOutput = project.localeProcessor.output;
let languages = project.localeProcessor.languages;
let primaryLanguage = languages[0];

// let translationClient = new MsTranslator({
//     api_key: '8c8477d3f33f43278329500590ee7b04'
// }, true); //TODO: make single request with arrays instead of individual ones


let allLocales = {};

export default gulp.series(
    readInLocaleFiles,
    ensureFileExistence,
    syncLocales,
    translateLocales, //Translate the English Locale file to all the others
);

function readInLocaleFiles() {
    return gulp.src(translationFiles)
        .pipe(through.obj((file, enc, cb) => {

            let locale = file.dirname.replace(/\\/g, '/').split('/').pop(); //Parent directory of file
            let namespace = file.basename.replace(/\.json$/, '');

            let localeTranslation = JSON.parse(file.contents.toString());

             //Initialize location for translation
            allLocales[locale] = allLocales[locale] || {};
            allLocales[locale][namespace] = allLocales[locale][namespace] || {};

            deepExtend(allLocales[locale][namespace], localeTranslation);
            cb(null, file);
        }));
}

function ensureFileExistence(done) {
    //Ensuring that we have basic files for all of our languages
    let fileWrites = [];

    let currentLocales = Object.keys(allLocales);
    for (let language of languages) {
        if (currentLocales.indexOf(language) < 0) {
            //create template file for translations
            console.log(`Missing language file for ${language}, creating new one.`);
            Object.keys(allLocales[primaryLanguage]).forEach(namespace => {
                fileWrites.push(new Promise((resolve, reject) => {
                    //Initialize location for translation
                    allLocales[language] = allLocales[language] || {};
                    allLocales[language][namespace] = allLocales[language][namespace] || {};
                    //Write new file
                    return fs.writeFile(`locales/${language}/${namespace}.json`, JSON.stringify({}), err => {
                        if (err) {
                            console.log('Failed to create file');
                            console.log(err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                }));
            });

        }
    }

    Promise.all(fileWrites)
        .then(() => {
            done();
        })
        .catch(err => {
            console.log(err);
            done();
        });
}

function syncLocales(done) {
    //Sync up all the locale files, make sure that any english translation exists in all the others, and any extra language is removed
    for (let language of languages) {
        deepExtend(allLocales[language], allLocales[primaryLanguage], (a, b) => {
            if (!a) { //If the value doesn't exist (in the destination language), copy over the needs translation text to new value
                return '__NEEDS_TRANSLATION__';
            }
            return a; //Keep any previous (destination) translation
        });
        traverse(allLocales[language], function(key, value, dotKey, parent) {
            if (!getPropFromDot(allLocales[primaryLanguage], dotKey)) {
                delete parent[key];
            }
        });
    }
    done();
}

function translateLocales() {
    //Translates locale info and writes translations to source and output locales

    //Should only read in English (primary) language, translate that, and write the output to all the other languages
    return gulp.src(translationFiles)
        .pipe(through.obj((file, enc, cb) => {
            let translationRequests = [];

            console.log('translating file: ' + file.path);

            //let localeTranslation = JSON.parse(file.contents.toString());
            let locale = file.dirname.replace(/\\/g, '/').split('/').pop();

            console.log('translating to: ' + locale);

            let namespace = path.basename(file.path, '.json');

            //If not english, translate
            if (locale !== 'en') {
                //Go through each property (from the english file) and translate
                traverse(allLocales[locale], function(key, value, dotKey) { //TODO: `value` here is only a copy to the original. Would be much better if it were a reference
                    if (typeof value === 'string') {
                        if (value !== '__NEEDS_TRANSLATION__') { //Then we're assuming we have a custom translation and we don't have to do anything
                            // If we have text and it's not the need translation text, then we have a custom translation and we're going to leave it alone

                            //MS Api
                            // Don't worry about access token, it will be auto-generated if needed.
                            // translationRequests.push(new Promise((resolve, reject) => {
                            //     translationClient.translate({
                            //         text: value,
                            //         from: 'en',
                            //         to: locale
                            //     }, function(err, res) {
                            //         if (err) {
                            //             reject(err);
                            //         }
                            //         try {
                            //             setTranslationKey(dotKey, res, localeTranslation, true);
                            //         } catch (e) {
                            //             reject(e);
                            //         }
                            //         resolve();
                            //     });
                            // }));

                            //Google Api
                            // translationRequests.push(
                            //     translate(value, {from: 'en', to: locale}).then(res => {
                            //         //localeTranslation[key] = res.text;
                            //         setTranslationKey(dotKey, res.text, localeTranslation, true);
                            //     }).catch(err => {
                            //         console.error(err);
                            //     })
                            // );
                        } else {
                            //Can we look at the primary (english) version to translate?
                            //At this point, we already know our namespace by the file location
                            //let namespaces = dotKey.split(':');

                            let primaryTranslation = getPropFromDot(allLocales[primaryLanguage], `${dotKey}`);//enLocale, dotKey);
                            if (primaryTranslation && primaryTranslation !== '__NEEDS_TRANSLATION__') { //We have an english translation to match
                                //We need to replace the token strings with numbers so we don't translate the values within, will replace after translation
                                let tokenizedStrings = getTokenizedStringWords(primaryTranslation);
                                let tokenPlace = 0;
                                let tokenizedPrimaryLanguage = primaryTranslation.replace(/{{([^}}]+)}}/g, () => {
                                    return `{{${tokenPlace++}}}`;
                                });
                                // MS Api
                                // Don't worry about access token, it will be auto-generated if needed.
                                // translationRequests.push(new Promise((resolve, reject) => {
                                //     translationClient.translate({
                                //         text: primaryTranslation,
                                //         from: primaryLanguage,
                                //         to: locale
                                //     }, function(err, res) {
                                //         if (err) {
                                //             reject(err);
                                //         }
                                //         try {
                                //             setTranslationKey(dotKey, res, allLocales[locale], true);
                                //         } catch (e) {
                                //             reject(e);
                                //         }
                                //         resolve();
                                //     });
                                // }));

                                //Google Api
                                translationRequests.push(
                                    translate(tokenizedPrimaryLanguage, {from: primaryLanguage, to: locale}).then(res => {
                                        //localeTranslation[key] = res.text;
                                        let tokenPlaceReplace = 0;
                                        let reTokenizedResult = res.text.replace(/{{([^}}]+)}}/g, () => {
                                            return `{{${tokenizedStrings[tokenPlaceReplace++]}}}`;
                                        });
                                        setTranslationKey(dotKey, reTokenizedResult, allLocales[locale], true);
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
                    file.contents = new Buffer(JSON.stringify(allLocales[locale][namespace], null, '\t'));
                    cb(null, file);
                });
        }))
        .pipe(gulp.dest('locales/'))
        .pipe(gulp.dest(translationFilesOutput));
}

/////////////////////////
////Utility functions////
/////////////////////////


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
function getTokenizedStringWords(str) {
    let results = [], re = /{{([^}}]+)}}/g, text;

    while (text = re.exec(str)) {
        results.push(text[1]);
    }
    return results;
}
