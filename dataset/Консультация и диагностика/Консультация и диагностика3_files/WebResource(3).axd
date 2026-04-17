
StiMvcViewer.prototype.ShowAnimationForMenu = function (menu, finishPos, endTime) {
    currentPos = menu.isSubMenu ? menu.offsetLeft : menu.offsetTop;
    if (finishPos == 0 && menu.visible) { currentPos = 0 }; //fixedBug
    clearTimeout(menu.animationTimer);

    var d = new Date();
    var t = d.getTime();
    var step = Math.round((finishPos - currentPos) / ((Math.abs(endTime - t) + 1) / 30));

    // Last step
    if (Math.abs(step) > Math.abs(finishPos - currentPos)) step = finishPos - currentPos;

    currentPos = currentPos + step;
    var resultPos;

    if (t < endTime) {
        resultPos = currentPos;
        menu.animationTimer = setTimeout("js" + menu.jsObject.options.mvcViewer.id + ".ShowAnimationForMenu(" + menu.id + ", " + finishPos + ", " + endTime + ")", 30);
    }
    else {
        resultPos = finishPos;
        menu.animationTimer = null;
        menu.visible = (finishPos == 0);
        if (!menu.visible) menu.parentElement.style.display = "none";
        if (!(menu.isSubMenu && menu.visible)) menu.parentButton.setSelected(menu.visible);
    }

    if (menu.isSubMenu)
        menu.style.left = resultPos + "px";
    else
        menu.style.top = resultPos + "px";
}

StiMvcViewer.prototype.ShowAnimationForm = function (formId, endTime) {
    var form = document.getElementById(formId);
    if (!form.flag) { form.currentOpacity = 1; form.flag = true; }
    clearTimeout(form.animationTimer);

    var d = new Date();
    var t = d.getTime();
    var step = Math.round((100 - form.currentOpacity) / ((Math.abs(endTime - t) + 1) / 30));

    // Last step
    if (Math.abs(step) > Math.abs(100 - form.currentOpacity)) step = 100 - form.currentOpacity;

    form.currentOpacity = form.currentOpacity + step;
    var resultOpacity;

    if (t < endTime) {
        resultOpacity = form.currentOpacity;
        form.animationTimer = setTimeout("js" + form.jsObject.options.mvcViewer.id + ".ShowAnimationForm('" + form.id + "', " + endTime + ")", 30);
    }
    else {
        resultOpacity = 100;
        form.flag = false;
        form.animationTimer = null;
    }

    form.style.opacity = resultOpacity / 100;
}

StiMvcViewer.prototype.ShowAnimationForScroll = function (reportPanel, finishScrollTop, endTime) {
    currentScrollTop = 0;
    if (reportPanel.jsObject.options.scrollbarsMode) currentScrollTop = reportPanel.scrollTop;
    else {
        currentScrollTop = document.documentElement.scrollTop;
        if (currentScrollTop == 0) currentScrollTop = document.getElementsByTagName('BODY')[0].scrollTop;
    }

    clearTimeout(reportPanel.animationTimer);
    var d = new Date();
    var t = d.getTime();
    var step = Math.round((finishScrollTop - currentScrollTop) / ((Math.abs(endTime - t) + 1) / 30));

    // Last step
    if (Math.abs(step) > Math.abs(finishScrollTop - currentScrollTop)) step = finishScrollTop - currentScrollTop;

    currentScrollTop += step;
    var resultScrollTop;

    if (t < endTime) {
        resultScrollTop = currentScrollTop;
        reportPanel.animationTimer = setTimeout("js" + reportPanel.jsObject.options.mvcViewer.id + ".ShowAnimationForScroll(" + reportPanel.id + ", " + finishScrollTop + ", " + endTime + ")", 30);
    }
    else resultScrollTop = finishScrollTop;

    if (reportPanel.jsObject.options.scrollbarsMode)
        reportPanel.scrollTop = resultScrollTop;
    else
        window.scrollTo(0, resultScrollTop);
}

StiMvcViewer.prototype.HideMenu = function (menu) {
    menu.hide();
}

StiMvcViewer.prototype.ShowMenu = function (menu) {
    menu.show();
}

StiMvcViewer.prototype.FindPosX = function (obj, mainClassName) {
    var curleft = 0;
    if (obj.offsetParent) {
        while (obj.className != mainClassName) {
            curleft += obj.offsetLeft;
            if (!obj.offsetParent) {
                break;
            }
            obj = obj.offsetParent;
        }
    } else if (obj.x) {
        curleft += obj.x;
    }
    return curleft;
}

StiMvcViewer.prototype.FindPosY = function (obj, mainClassName) {
    var curtop = 0;
    if (obj.offsetParent) {
        while (obj.className != mainClassName) {
            curtop += obj.offsetTop;
            if (!obj.offsetParent) {
                break;
            }
            obj = obj.offsetParent;
        }
    } else if (obj.y) {
        curtop += obj.y;
    }
    return curtop;
}

StiMvcViewer.prototype.hideAllMenus = function () {
    if (this.options.currentSubMenu) this.options.currentSubMenu.hide();
    if (this.options.currentMenu) {
        if (this.options.currentSubMenu) {
            if (this.options.menuAnimation)
                this.options.currentMenu.hideWithDelay(this.options.menuHideDelay);
            else
                this.options.currentMenu.hide();
        }
        else this.options.currentMenu.hide();
    }

    this.options.currentSubMenu = null;
    this.options.currentMenu = null;
    this.hideAllParameterMenus();
}

StiMvcViewer.prototype.hideAllParameterMenus = function () {
    if (!this.options.parametersPanel.dropDownButtonWasClicked)
        if (this.options.parametersPanel.currentOpeningParameter != null) this.options.parametersPanel.currentOpeningParameter.changeVisibleStateMenu(false);
    if (!this.options.parametersPanel.dateTimeButtonWasClicked)
        this.options.datePicker.hide();
    
    this.options.parametersPanel.dropDownButtonWasClicked = false;
    this.options.parametersPanel.dateTimeButtonWasClicked = false;
}

StiMvcViewer.prototype.isContainted = function (array, item) {
    for (var index in array)
        if (item == array[index]) return true;

    return false;
}

StiMvcViewer.prototype.getCssParameter = function (css) {
    if (css.indexOf(".gif]") > 0) return css.substr(css.indexOf("["), css.indexOf("]") - css.indexOf("[") + 1);
    return null;
}

StiMvcViewer.prototype.newGuid = (function () {
    var CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
    return function (len, radix) {
        var chars = CHARS, uuid = [], rnd = Math.random;
        radix = radix || chars.length;

        if (len) {
            for (var i = 0; i < len; i++) uuid[i] = chars[0 | rnd() * radix];
        } else {
            var r;
            uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
            uuid[14] = '4';

            for (var i = 0; i < 36; i++) {
                if (!uuid[i]) {
                    r = 0 | rnd() * 16;
                    uuid[i] = chars[(i == 19) ? (r & 0x3) | 0x8 : r & 0xf];
                }
            }
        }

        return uuid.join('');
    };
})();

StiMvcViewer.prototype.formatDate = function (formatDate, formatString) {
    var yyyy = formatDate.getFullYear();
    var yy = yyyy.toString().substring(2);
    var m = formatDate.getMonth() + 1;
    var mm = m < 10 ? "0" + m : m;
    var d = formatDate.getDate();
    var dd = d < 10 ? "0" + d : d;

    var h = formatDate.getHours();
    var hh = h < 10 ? "0" + h : h;
    var n = formatDate.getMinutes();
    var nn = n < 10 ? "0" + n : n;
    var s = formatDate.getSeconds();
    var ss = s < 10 ? "0" + s : s;

    formatString = formatString.replace(/yyyy/i, yyyy);
    formatString = formatString.replace(/yy/i, yy);
    formatString = formatString.replace(/MM/, mm);
    formatString = formatString.replace(/M/, m);
    formatString = formatString.replace(/dd/i, dd);
    formatString = formatString.replace(/d/i, d);
    formatString = formatString.replace(/hh/i, hh);
    formatString = formatString.replace(/h/i, h);
    formatString = formatString.replace(/mm/, nn);
    formatString = formatString.replace(/m/, n);
    formatString = formatString.replace(/ss/i, ss);
    formatString = formatString.replace(/s/i, s);

    return formatString;
}

StiMvcViewer.prototype.dateTimeObjectToString = function (dateTimeObject, typeDateTimeObject) {
    date = new Date();
    date.setYear(dateTimeObject.year);
    date.setMonth(dateTimeObject.month - 1);
    date.setDate(dateTimeObject.day);
    date.setHours(dateTimeObject.hours);
    date.setMinutes(dateTimeObject.minutes);
    date.setSeconds(dateTimeObject.seconds);

    if (this.options.dateFormat != "") return this.formatDate(date, this.options.dateFormat);
    if (typeDateTimeObject == "Time") return date.toLocaleTimeString();
    if (typeDateTimeObject == "Date") return date.toLocaleDateString();
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
}

StiMvcViewer.prototype.getStringKey = function (key, parameter) {
    stringKey = (parameter.params.type == "DateTime")
        ? this.dateTimeObjectToString(key, parameter.params.dateTimeType) 
        : key;

    return stringKey;
}

StiMvcViewer.prototype.getCountObjects = function (objectArray) {
    count = 0;
    if (objectArray)
        for (var singleObject in objectArray) { count++ };
    return count;
}

StiMvcViewer.prototype.getNowDateTimeObject = function () {
    date = new Date();
    dateTimeObject = {};
    dateTimeObject.year = date.getFullYear();
    dateTimeObject.month = date.getMonth() + 1;
    dateTimeObject.day = date.getDate();
    dateTimeObject.hours = date.getHours();
    dateTimeObject.minutes = date.getMinutes();
    dateTimeObject.seconds = date.getSeconds();

    return dateTimeObject;
}

StiMvcViewer.prototype.getNowTimeSpanObject = function () {
    date = new Date();
    timeSpanObject = {};
    timeSpanObject.hours = date.getHours();
    timeSpanObject.minutes = date.getMinutes();
    timeSpanObject.seconds = date.getSeconds();

    return timeSpanObject;
}

StiMvcViewer.prototype.copyObject = function (o) {
    if (!o || "object" !== typeof o) {
        return o;
    }
    var c = "function" === typeof o.pop ? [] : {};
    var p, v;
    for (p in o) {
        if (o.hasOwnProperty(p)) {
            v = o[p];
            if (v && "object" === typeof v) {
                c[p] = this.copyObject(v);
            }
            else c[p] = v;
        }
    }
    return c;
}

StiMvcViewer.prototype.CreateHTMLTable = function (rowsCount, cellsCount) {
    var table = document.createElement("table");
    table.cellPadding = 0;
    table.cellSpacing = 0;
    table.tr = [];
    table.tr[0] = document.createElement("tr");
    table.appendChild(table.tr[0]);

    table.addCell = function (control) {
        var cell = document.createElement("td");
        this.tr[0].appendChild(cell);
        if (control) cell.appendChild(control);

        return cell;
    }

    table.addCellInNextRow = function (control) {
        var rowCount = this.tr.length;
        this.tr[rowCount] = document.createElement("tr");
        this.appendChild(this.tr[rowCount]);
        var cell = document.createElement("td");
        this.tr[rowCount].appendChild(cell);
        if (control) cell.appendChild(control);

        return cell;
    }

    table.addCellInLastRow = function (control) {
        var rowCount = this.tr.length;
        var cell = document.createElement("td");
        this.tr[rowCount - 1].appendChild(cell);
        if (control) cell.appendChild(control);

        return cell;
    }

    table.addCellInRow = function (rowNumber, control) {
        var cell = document.createElement("td");
        this.tr[rowNumber].appendChild(cell);
        if (control) cell.appendChild(control);

        return cell;
    }

    table.addRow = function () {
        var rowCount = this.tr.length;
        this.tr[rowCount] = document.createElement("tr");
        this.appendChild(this.tr[rowCount]);

        return this.tr[rowCount];
    }

    return table;
}

StiMvcViewer.prototype.ShowHelpWindow = function (url) {
    window.open("http://www.stimulsoft.com/" + this.options.helpLanguage + "/documentation/online/" + url);
}

StiMvcViewer.prototype.GetXmlValue = function (xml, key) {
    var string = xml.substr(0, xml.indexOf("</" + key + ">"));
    return string.substr(xml.indexOf("<" + key + ">") + key.length + 2);
}
