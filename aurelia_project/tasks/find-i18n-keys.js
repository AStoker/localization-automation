/*
Purpose:
    -To find keys (and only keys) used for translations
    - Write those keys to a json file with a default value of '__NEEDS_TRANSLATION__'

Some keys don't have text to match up with the key, so it's helpful to at least have all the keys listed.
A different task is in charge of finding values for keys.
*/

import gulp from 'gulp';
import project from '../aurelia.json';

import scanner from 'i18next-scanner';

let locationsToScan = project.localeProcessor.translateFiles;
let languagesToTranslateTo = project.localeProcessor.languages;

let htmlAttributesToUse = ['i18n', 't'];
let javascriptFunctionsToUse = ['this.i18n.tr', 'i18n.tr'];
let namespacesToUse = project.localeProcessor.namespaces;//['translation']; //Let default be the first one in list

let existingLocaleFiles = '../../locales/{{lng}}/{{ns}}.json'; // the source path is relative to current working directory
let saveLocaleFilesTo = '{{lng}}/toTranslate_{{ns}}.json'; // the destination path is relative to your `gulp.dest()` path (localeFileDestination)
let localeFileDestination = 'locales'; // relative to project root


export default gulp.series(
    findi18nInstances
);

function findi18nInstances() {
    return gulp.src(locationsToScan)
        .pipe(scanner({
            sort: true,
            removeUnusedKeys: true,
            defaultValue: '__NEEDS_TRANSLATION__',
            lngs: languagesToTranslateTo, // ['en', 'fr', 'es', 'pt'], // ,'gb'], // supported languages
            attr: {
                list: htmlAttributesToUse
            },
            func: {
                list: javascriptFunctionsToUse
            },
            ns: namespacesToUse,
            defaultNs: namespacesToUse[0],
            resource: {
                // the source path is relative to current working directory
                loadPath: existingLocaleFiles,

                // the destination path is relative to your `gulp.dest()` path
                savePath: saveLocaleFilesTo
            }
        }))
        .pipe(gulp.dest(localeFileDestination));
}
