
function StiMvcViewer(parameters, images) {
    this.options = {
        "mvcViewer": null,
        "reportPanel": null,
        "parametersPanel": null,
        "toolbar": null,
        "buttons": {},
        "forms": {},
        "bookmarks": null,
        "datePicker": null,
        "toolTip": null,
        "css": null,
        "head": null,
        "routes": null,
        "formValues": null,
        "processImage": null,
        "currentMenu": null,
        "currentSubMenu": null,
        "menuShowMode": "Hover",
        "menuAnimation": true,
        "menuDuration": 200,
        "menuHideDelay": 300,
        "menuPrintDestination": "Default",
        "menuViewMode": "OnePage",
        "subMenuDelay": 350,
        "scrollDuration": 350,
        "requestUrl": null,
        "actionGetReportSnapshot": null,
        "actionViewerEvent": null,
        "actionPrintReport": null,
        "actionExportReport": null,
        "actionEmailReport": null,
        "actionDesignReport": null,
        "actionInteraction": null,
        "serverCacheMode": "Page",
        "serverTimeout": null,
        "serverCacheItemPriority": null,
        "reportGuid": null,
        "paramsGuid": null,
        "pageNumber": 0,
        "pagesCount": 0,
        "pageMargins": ["0px 0px 0px 0px"],
        "pageSizes": [{ "width": 0, "height": 0}],
        "pageBackgrounds": ["#ffffff"],
        "pageShowShadow": true,
        "pageBorderColor": null,
        "zoom": 100,
        "scrollbarsMode": false,
        "rightToLeft": false,
        "bookmarkAnchor": null,
        "bookmarksVisible": true,
        "bookmarksPrint": false,
        "bookmarksTreeWidth": 180,
        "haveBookmarks": false,
        "showExportDialog": true,
        "showEmailDialog": true,
        "parameters": null,
        "parametersValues": {},
        "paramsProps": null,
        "countColumnsParameters": 2,
        "openLinksTarget": "_self",
        "openExportedReportTarget": "_blank",
        "isParametersReceived": false,
        "isReportRecieved": false,
        "defaultExportSettings": null,
        "requestTimeout": 20,
        "emailSuccessfullySent": "",
        "reportFileName": "",
        "dateFormat": "",
    }

    this.options.mvcViewer = document.getElementById(parameters.mvcViewerId);
    this.options.head = document.getElementsByTagName("head")[0];
    this.options.mainPanel = document.getElementById(parameters.mvcViewerId + "_MainPanel");
    this.options.requestUrl = parameters.requestUrl;
    this.options.routes = parameters.routes;
    this.options.formValues = parameters.formValues;
    this.options.actionGetReportSnapshot = parameters.actionGetReportSnapshot;
    this.options.actionViewerEvent = parameters.actionViewerEvent;
    this.options.actionPrintReport = parameters.actionPrintReport;
    this.options.actionExportReport = parameters.actionExportReport;
    this.options.actionEmailReport = parameters.actionEmailReport;
    this.options.actionDesignReport = parameters.actionDesignReport;
    this.options.actionInteraction = parameters.actionInteraction;
    this.options.serverCacheMode = parameters.serverCacheMode;
    this.options.serverTimeout = parameters.serverTimeout;
    this.options.serverCacheItemPriority = parameters.serverCacheItemPriority;
    this.options.menuShowMode = parameters.menuShowMode;
    this.options.menuAnimation = parameters.menuAnimation;
    this.options.menuPrintDestination = parameters.menuPrintDestination;
    this.options.menuViewMode = parameters.menuViewMode;
    this.options.zoom = parameters.menuZoom;
    this.options.pageShowShadow = parameters.pageShowShadow;
    this.options.pageBorderColor = parameters.pageBorderColor;
    this.options.scrollbarsMode = parameters.scrollbarsMode;
    this.options.rightToLeft = parameters.rightToLeft;
    this.options.bookmarksVisible = parameters.bookmarksVisible;
    this.options.bookmarksPrint = parameters.bookmarksPrint;
    this.options.bookmarksTreeWidth = parameters.bookmarksTreeWidth;
    this.options.showExportDialog = parameters.showExportDialog;
    this.options.showEmailDialog = parameters.showEmailDialog;
    this.options.countColumnsParameters = parameters.countColumnsParameters;
    this.options.openLinksTarget = parameters.openLinksTarget;
    this.options.openExportedReportTarget = parameters.openExportedReportTarget;
    this.options.defaultExportSettings = parameters.defaultExportSettings;
    this.options.requestTimeout = parameters.requestTimeout;
    this.options.helpLanguage = parameters.helpLanguage;
    this.options.showTooltips = parameters.showTooltips;
    this.options.emailSuccessfullySent = parameters.emailSuccessfullySent;
    this.options.defaultEmailAddress = parameters.defaultEmailAddress;
    this.options.defaultEmailMessage = parameters.defaultEmailMessage;
    this.options.defaultEmailSubject = parameters.defaultEmailSubject;
    this.options.wordTellMeMore = parameters.wordTellMeMore;
    this.options.dateFormat = parameters.dateFormat;
    this.InitializeToolTip();
    this.prepareStyles(images);    
}

StiMvcViewer.prototype.prepareStyles = function (images) {
    var head = this.options.head;
    for (i = 0; i < head.childNodes.length; i++) {
        var node = head.childNodes[i];
        if (node.type == "text/css") {
            if (node.sheet && node.sheet.cssRules) {
                for (j = 0; j < node.sheet.cssRules.length; j++) {
                    css = node.sheet.cssRules[j];
                    if (css.style && css.style.backgroundImage.indexOf(".gif]") > 0) {
                        backgroundImage = css.style.backgroundImage;
                        backgroundImage = backgroundImage.substr(backgroundImage.indexOf("["), backgroundImage.indexOf("]") - backgroundImage.indexOf("[") + 1);
                        if (images[backgroundImage] && images[backgroundImage] != " ") css.style.backgroundImage = "url('" + images[backgroundImage] + "')";
                        else css.style.backgroundImage = "none";
                    }
                }
            }
            else {
                if (node.styleSheet) {
                    cssText = node.styleSheet.cssText;
                    while (param = this.getCssParameter(cssText)) cssText = cssText.replace(param, images[param]);
                    node.styleSheet.cssText = cssText;
                }
            }
        }
    }
}

StiMvcViewer.prototype.showError = function (text) {
    if (text != null && text.substr(0, 6) == "Error:") {
        if (text.length == 7) text += "Undefined";
        alert(text);
        return true;
    }

    return false;
}

StiMvcViewer.prototype.createXMLHttp = function () {
    if (typeof XMLHttpRequest != "undefined") return new XMLHttpRequest();
    else if (window.ActiveXObject) {
        var allVersions = [
            "MSXML2.XMLHttp.5.0",
            "MSXML2.XMLHttp.4.0",
            "MSXML2.XMLHttp.3.0",
            "MSXML2.XMLHttp",
            "Microsoft.XMLHttp"
        ];
        for (var i = 0; i < allVersions.length; i++) {
            try {
                var xmlHttp = new ActiveXObject(allVersions[i]);
                return xmlHttp;
            }
            catch (oError) {
            }
        }
    }
    throw new Error("Unable to create XMLHttp object.");
}

StiMvcViewer.prototype.createUrlParameters = function (asObject) {
    if (this.options.zoom == -1 || this.options.zoom == -2) this.options.reZoom = this.options.zoom;

    var params = {
        "mvcviewerid": this.options.mvcViewer.id,
        "routes": this.options.routes,
        "formValues": this.options.formValues,
        "reportguid": this.options.reportGuid,
        "paramsguid": this.options.paramsGuid,
        "servercachemode": this.options.serverCacheMode,
        "servertimeout": this.options.serverTimeout,
        "servercacheitempriority": this.options.serverCacheItemPriority,
        "pagenumber": this.options.pageNumber,
        "zoom": (this.options.zoom == -1 || this.options.zoom == -2) ? 100 : this.options.zoom,
        "viewmode": this.options.menuViewMode,
        "bookmarksvisible": this.options.bookmarksVisible,
        "openlinkstarget": this.options.openLinksTarget
    };

    if (asObject) return params;

    var urlParams = "";
    for (var key in params) {
        if (urlParams != "") urlParams += "&";
        urlParams += key + "=" + params[key];
    }

    return urlParams;
}

StiMvcViewer.prototype.postAjax = function (url, postData, callback) {
    var jsObject = this;
    var xmlHttp = this.createXMLHttp();

    var parameters = this.createUrlParameters(false);
    if (postData) {
        for (var key in postData) {
            parameters += "&" + key + "=" + postData[key];
        }
    }

    if (jsObject.options.requestTimeout != 0) {
        setTimeout(function () {
            if (xmlHttp.readyState < 4) xmlHttp.abort();
        }, jsObject.options.requestTimeout * 1000);
    }

    xmlHttp.open("POST", url, true);
    xmlHttp.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xmlHttp.onreadystatechange = function () {
        if (xmlHttp.readyState == 4) {
            var status = 0;
            try {
                status = xmlHttp.status;
            }
            catch (e) {
            }

            if (status == 0) {
                callback("Error: Timeout response from the server", jsObject);
            } else if (status == 200) {
                callback(xmlHttp.responseText, jsObject);
            } else {
                callback("Error: " + status + " - " + xmlHttp.statusText, jsObject);
            }
        }
    };

    xmlHttp.send(parameters);
}

StiMvcViewer.prototype.postForm = function (url, postData, doc) {
    if (!doc) doc = document;
    var params = this.createUrlParameters(true);
    if (postData)
        for (var key in postData) {
            params[key] = postData[key];
        }

    postData = params;

    var form = doc.createElement("FORM");
    form.setAttribute("method", "POST");
    form.setAttribute("action", url);

    for (var key in postData) {
        var hiddenField = doc.createElement("INPUT");
        hiddenField.setAttribute("type", "hidden");
        hiddenField.setAttribute("name", key);
        hiddenField.setAttribute("value", postData[key]);

        form.appendChild(hiddenField);
    }

    doc.body.appendChild(form);
    form.submit();
    doc.body.removeChild(form);
}

StiMvcViewer.prototype.postAction = function (action, bookmarkPage, bookmarkAnchor) {
    switch (action) {
        case "Print":
            switch (this.options.menuPrintDestination) {
                case "Pdf": this.postPrint("PrintPdf"); break;
                case "Direct": this.postPrint("PrintWithoutPreview"); break;
                case "PopupWindow": this.postPrint("PrintWithPreview"); break;
            }
            break;

        case "FirstPage": this.options.pageNumber = 0; break;
        case "PrevPage": if (this.options.pageNumber > 0) this.options.pageNumber--; break;
        case "NextPage": if (this.options.pageNumber < this.options.pagesCount - 1) this.options.pageNumber++; break;
        case "LastPage": this.options.pageNumber = this.options.pagesCount - 1; break;
        case "Zoom25": this.options.zoom = 25; break;
        case "Zoom50": this.options.zoom = 50; break;
        case "Zoom75": this.options.zoom = 75; break;
        case "Zoom100": this.options.zoom = 100; break;
        case "Zoom150": this.options.zoom = 150; break;
        case "Zoom200": this.options.zoom = 200; break;
        case "ZoomOnePage": this.options.zoom = parseInt(this.options.reportPanel.getZoomByPageHeight()); break;
        case "ZoomPageWidth": this.options.zoom = parseInt(this.options.reportPanel.getZoomByPageWidth()); break;
        case "ViewModeOnePage": this.options.menuViewMode = "OnePage"; break;
        case "ViewModeWholeReport": this.options.menuViewMode = "WholeReport"; break;
        case "GoToPage": this.options.pageNumber = this.options.buttons["PageControlText"].getCorrectValue() - 1; break;

        case "BookmarkAction":
            if (this.options.pageNumber == bookmarkPage) {
                this.scrollToAnchor(bookmarkAnchor);
                return;
            } else {
                this.options.pageNumber = bookmarkPage;
                this.options.bookmarkAnchor = bookmarkAnchor;
            }
            break;

        case "Bookmarks": this.options.bookmarks.changeVisibleState(!this.options.buttons["Bookmarks"].isSelected); return;
        case "Parameters": this.options.parametersPanel.changeVisibleState(!this.options.buttons["Parameters"].isSelected); return;
        case "Design": this.postDesign(); return;

        case "ExportFormOk":
            if (this.options.forms["ExportForm"].action == this.options.actionEmailReport && this.options.showEmailDialog) {
                this.options.forms["SendEmailForm"].exportFormat = this.options.forms["ExportForm"].exportFormat;
                this.options.forms["SendEmailForm"].exportSettings = this.options.forms["ExportForm"].applySettings();
                this.options.forms["SendEmailForm"].show();
            }
            else this.postExport(this.options.forms["ExportForm"].exportFormat, this.options.forms["ExportForm"].applySettings(), this.options.forms["ExportForm"].action);
            return;
        case "ExportFormCancel": this.options.forms["ExportForm"].hide(); return;
        case "DigitalSignatureButton": this.options.forms["DigitalSignatureForm"].show(); return;
        case "DocumentSecurityButton": this.options.forms["DocumentSecurityForm"].show(); return;
        case "DigitalSignatureFormOk": this.options.forms["DigitalSignatureForm"].hide(); return;
        case "DocumentSecurityFormOk": this.options.forms["DocumentSecurityForm"].hide(); return;
        case "DigitalSignatureFormCancel": this.options.forms["DigitalSignatureForm"].hide(); this.options.forms["DigitalSignatureForm"].resetControls(); return;
        case "DocumentSecurityFormCancel": this.options.forms["DocumentSecurityForm"].hide(); this.options.forms["DocumentSecurityForm"].resetControls(); return;
        case "SendEmailFormOk": this.postExport(this.options.forms["ExportForm"].exportFormat, this.options.forms["SendEmailForm"].applySettings(), this.options.actionEmailReport); return;
        case "SendEmailFormCancel": this.options.forms["SendEmailForm"].hide(); return;

        case "Submit":
            this.options.pageNumber = 0;
            this.postInteraction(true);
            return;

        case "Reset":
            this.options.parameters = {};
            this.options.parametersPanel.clearParameters();
            this.options.parametersPanel.addParameters();
            return;
    }

    this.options.processImage.show();
    this.postAjax(this.options.requestUrl.replace("{action}",
            (action == null || this.options.serverCacheMode == "None")
                ? this.options.actionGetReportSnapshot
                : this.options.actionViewerEvent),
            null, this.showReportPage);
}

StiMvcViewer.prototype.postPrint = function (action) {
    if (this.options.actionPrintReport == "") return;

    var postData = {
        "bookmarksprint": this.options.bookmarksPrint,
        "printaction": action
    };

    switch (action) {
        case "PrintPdf":
            var urlParams = this.createUrlParameters(false);
            for (var key in postData) urlParams += "&" + key + "=" + postData[key];
            this.printAsPdf(this.options.requestUrl.replace("{action}", this.options.actionPrintReport) + "?" + urlParams);
            break;
        case "PrintWithPreview": this.printAsPopup(this.options.requestUrl.replace("{action}", this.options.actionPrintReport), postData); break;
        case "PrintWithoutPreview": this.postAjax(this.options.requestUrl.replace("{action}", this.options.actionPrintReport), postData, this.printAsHtml); break;
    }
}

StiMvcViewer.prototype.printAsPdf = function (url) {
    printFrame = document.getElementById("pdfPrintFrame");
    if (printFrame == null) {
        printFrame = document.createElement("iframe");
        printFrame.id = "pdfPrintFrame";
        printFrame.name = "pdfPrintFrame";
        printFrame.width = "0px";
        printFrame.height = "0px";
        printFrame.style.position = "absolute";
        printFrame.style.border = "none";
        document.body.appendChild(printFrame, document.body.firstChild);
    }

    printFrame.src = url;
}

StiMvcViewer.prototype.printAsPopup = function (url, postData) {
    var win = window.open("about:blank", "PrintReport", "height=900, width=790, toolbar=no, menubar=yes, scrollbars=yes, resizable=yes, location=no, directories=no, status=no");
    if (win != null) this.postForm(url, postData, win.document);
}

StiMvcViewer.prototype.printAsHtml = function (text, jsObject) {
    if (jsObject.showError(text)) return;

    if (navigator.userAgent.indexOf("Opera") != -1) {
        var operaWin = window.open("about:blank");
        operaWin.document.body.innerHTML = text;
        operaWin.opener.focus();
        operaWin.print();
        operaWin.close();
        operaWin = null;
    }
    else {
        printFrame = document.getElementById("htmlPrintFrame");
        if (printFrame == null) {
            printFrame = document.createElement("iframe");
            printFrame.id = "htmlPrintFrame";
            printFrame.name = "htmlPrintFrame";
            printFrame.width = "0px";
            printFrame.height = "0px";
            printFrame.style.position = "absolute";
            printFrame.style.border = "none";
            document.body.appendChild(printFrame, document.body.firstChild);
        }

        printFrame.contentWindow.document.open();
        printFrame.contentWindow.document.write(text);
        printFrame.contentWindow.document.close();
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
    }
}

StiMvcViewer.prototype.clickExport = function (exportFormat) {
    this.showExportForm(exportFormat, this.options.actionExportReport);
}

StiMvcViewer.prototype.clickSendEmail = function (exportFormat) {
    this.showExportForm(exportFormat, this.options.actionEmailReport);
}

StiMvcViewer.prototype.showExportForm = function (exportFormat, action) {
    this.options.forms["ExportForm"].exportFormat = exportFormat;
    this.options.forms["ExportForm"].action = action;
    this.options.forms["ExportForm"].show();
    if (!this.options.showExportDialog || exportFormat == "Xml")
        this.postExport(this.options.forms["ExportForm"].exportFormat, this.options.forms["ExportForm"].applySettings(), action);
}

StiMvcViewer.prototype.postExport = function (format, settings, action) {
    if (action == "") return;

    var postData = {
        "exportformat": format,
        "exportsettings": JSON.stringify(settings)
    };

    if (action == this.options.actionEmailReport)
        this.postAjax(this.options.requestUrl.replace("{action}", action), postData, this.emailResult);
    else {
        var doc = null;
        if (settings.OpenAfterExport && this.options.openExportedReportTarget == "_blank") doc = window.open("about:blank", "ExportReport", "toolbar=no, menubar=yes, scrollbars=yes, resizable=yes, location=no, directories=no, status=no").document;
        this.postForm(this.options.requestUrl.replace("{action}", action), postData, doc);
    }
}

StiMvcViewer.prototype.postDesign = function () {
    //document.location = this.options.requestUrl.replace("{action}", this.options.actionDesignReport);
    this.postForm(this.options.requestUrl.replace("{action}", this.options.actionDesignReport));
}

StiMvcViewer.prototype.postInteraction = function (sendParams) {
    if (this.options.actionInteraction == "") {
        if (this.options.buttons["Parameters"]) this.options.buttons["Parameters"].setEnabled(false);
        return;
    }

    // Interaction parameters
    if (sendParams) {
        parameters = this.options.parametersPanel.getParametersValues();
        var postData = {
            "parameters": JSON.stringify(parameters)
        };
        this.options.paramsGuid = hex_md5(postData.parameters);
    }

    this.options.processImage.show();
    this.postAjax(this.options.requestUrl.replace("{action}", this.options.actionInteraction), postData, sendParams ? this.showReportPage : this.postInteractionResult);
}

StiMvcViewer.prototype.postInteractionResult = function (jsText, jsObject) {
    if (jsObject.showError(jsText)) jsText = null;

    jsObject.options.isParametersReceived = true;
    paramsProps = JSON.parse(jsText);
    jsObject.options.paramsProps = paramsProps;

    if (jsObject.options.parameters == null) {
        if (paramsProps != null) {
            jsObject.options.parameters = {};
            jsObject.options.parametersPanel.addParameters();
        }
        if (buttons["Parameters"]) buttons["Parameters"].setEnabled(paramsProps != null);
        jsObject.options.parametersPanel.changeVisibleState(paramsProps != null);
    }
}

StiMvcViewer.prototype.parseParameters = function (htmlText) {
    if (htmlText.substr(0, 1) == "{") {
        var parameters = JSON.parse(htmlText.substr(0, htmlText.indexOf("##")));
        htmlText = htmlText.substr(htmlText.indexOf("##") + 2);

        this.options.pageNumber = parameters.pageNumber;
        this.options.pagesCount = parameters.pagesCount;
        this.options.pageMargins = parameters.pageMargins;
        this.options.pageSizes = parameters.pageSizes;
        this.options.pageBackgrounds = parameters.pageBackgrounds;
        this.options.zoom = parameters.zoom;
        this.options.menuViewMode = parameters.viewMode;
        this.options.reportGuid = parameters.reportGuid;
        this.options.reportFileName = parameters.reportFileName;
    }

    return htmlText;
}

StiMvcViewer.prototype.scrollToAnchor = function (anchor) {
    for (var i = 0; i < document.anchors.length; i++) {
        if (document.anchors[i].name == anchor) {
            anchorElement = document.anchors[i];
            targetTop = this.FindPosY(anchorElement, this.options.scrollbarsMode ? "stiReportPanel" : null) - 5;
            d = new Date();
            endTime = d.getTime() + this.options.scrollDuration;
            this.ShowAnimationForScroll(this.options.reportPanel, targetTop, endTime);
            break;
        }
    }
}

StiMvcViewer.prototype.emailResult = function (text, jsObject) {    
    if (text == "0")
        alert(jsObject.options.emailSuccessfullySent);
    else {
        if (text.indexOf("<?xml") == 0) {        
            alert(jsObject.GetXmlValue(text, "ErrorCode"));
            alert(jsObject.GetXmlValue(text, "ErrorDescription"));
        }
        else 
            alert(text);
    }
}

StiMvcViewer.prototype.showReportPage = function (htmlText, jsObject) {
    if (htmlText == "null" && isReportRecieved) {
        isReportRecieved = false;
        jsObject.postAction();
        return;
    }
    isReportRecieved = true;

    if (jsObject.showError(htmlText)) htmlText = "";

    htmlText = jsObject.parseParameters(htmlText);
    pagesArray = htmlText.split("###STIMULSOFTPAGESEPARATOR###");

    var pageNumber = -1;
    var reportPanel = jsObject.options.reportPanel;
    reportPanel.clear();
    for (var num = 0; num < pagesArray.length; num++) {
        if (num == 0) {
            if (jsObject.options.css == null) {
                jsObject.options.css = document.createElement("STYLE");
                jsObject.options.css.setAttribute("type", "text/css");
                jsObject.options.head.appendChild(jsObject.options.css);
            }
            if (jsObject.options.css.styleSheet) jsObject.options.css.styleSheet.cssText = pagesArray[num];
            else jsObject.options.css.innerHTML = pagesArray[num];
        }
        else if (pagesArray[num].indexOf("bookmarks") == 0) {
            eval(pagesArray[num]); // create the 'bookmarks' object
            if (jsObject.options.bookmarks) {
                jsObject.options.bookmarks.addContent(bookmarks.toString());
                if (!jsObject.options.haveBookmarks) jsObject.options.bookmarks.changeVisibleState(true);
                jsObject.options.haveBookmarks = true;
            }
        }
        else {
            pageNumber++;
            reportPanel.addPage(pagesArray[num], pageNumber);
        }
    }

    if (!jsObject.options.isParametersReceived) jsObject.postInteraction(false);

    if (jsObject.options.bookmarks && jsObject.options.buttons["Bookmarks"]) {
        jsObject.options.bookmarks.changeVisibleState(jsObject.options.buttons["Bookmarks"].isSelected);
    }

    if (jsObject.options.toolbar) jsObject.options.toolbar.changeToolBarState();

    jsObject.options.processImage.hide();

    // Go to the bookmark, if it present
    if (jsObject.options.bookmarkAnchor != null) {
        jsObject.scrollToAnchor(jsObject.options.bookmarkAnchor);
        jsObject.options.bookmarkAnchor = null;
    }

    if (jsObject.options.reZoom != null) {
        jsObject.postAction(jsObject.options.reZoom == -1 ? "ZoomPageWidth" : "ZoomOnePage");
        jsObject.options.reZoom = null;
    }
}