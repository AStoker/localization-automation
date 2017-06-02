import environment from './environment';
import {
  Backend,
  TCustomAttribute
} from 'aurelia-i18n';
import LngDetector from 'i18next-browser-languagedetector';

//Configure Bluebird Promises.
Promise.config({
  warnings: {
    wForgottenReturn: false
  }
});

export function configure(aurelia) {
  TCustomAttribute.configureAliases(['t', 'i18n']);
  aurelia.use
    .standardConfiguration()
    .feature('resources')
    .plugin('aurelia-i18n', (instance) => {
      // register backend plugin
      instance.i18next
        .use(Backend.with(aurelia.loader))
        .use(LngDetector)
        //.use(Cache)
        .init({
          cache: {
            // turn on or off
            enabled: false,

            // prefix for stored languages
            prefix: 'i18next_res_',

            // expiration - 1 week
            expirationTime: 7 * 24 * 60 * 60 * 1000
          }
        });
      // adapt options to your needs (see http://i18next.com/docs/options/)
      // make sure to return the promise of the setup method, in order to guarantee proper loading
      return instance.setup({
        backend: { // <-- configure backend settings
          loadPath: '/locales/{{lng}}/{{ns}}.json' // <-- XHR settings for where to get the files from
        },
        //lng: 'en', //Not needed due to language detection
        attributes: ['i18n', 't'], //Use the alias configuration described at top of configure function as well to work with globals
        fallbackLng: 'en',
        load: 'languageOnly',
        ns: ['translation'],
        defaultNS: 'translation',
        debug: true,
        detection: {
          // order and from where user language should be detected
          order: ['navigator', 'localStorage', 'htmlTag', 'querystring'], //['navigator', 'localStorage', 'cookie', 'htmlTag', 'querystring'],

          // keys or params to lookup language from
          lookupQuerystring: 'lng',
          //lookupCookie: 'i18next',
          lookupLocalStorage: 'i18nextLng',

          // cache user language on
          caches: ['localStorage'] // ['localStorage', 'cookie']

          // optional expire and domain for set cookie
          // cookieMinutes: 10,
          // cookieDomain: 'myDomain',

          // optional htmlTag with lang attribute, the default is:
          // htmlTag: document.documentElement
        }
      });
    });

  if (environment.debug) {
    aurelia.use.developmentLogging();
  }

  if (environment.testing) {
    aurelia.use.plugin('aurelia-testing');
  }

  aurelia.start().then(() => aurelia.setRoot());
}
