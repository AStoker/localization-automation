import { inject } from 'aurelia-framework';
import {I18N} from 'aurelia-i18n';

@inject(I18N)
export class App {
  constructor(i18n) {
    this.i18n = i18n;

    this.subMessage = this.i18n.tr('Some.Test');
  }
}
