
StiMvcViewer.prototype.InitializeExportForm = function (form) {
    this.InitializeForm(form);
    form.exportFormat = null;

    form.onshow = function () {
        if (this.formName == "ExportForm") {
            this.resetControls();
            this.setDefaultValues();
        }
        else this.jsObject.options.forms["ExportForm"].setEnabled(false);
    }

    form.onhide = function () {
        this.jsObject.options.forms["ExportForm"].setEnabled(true);
        if (this.formName == "ExportForm") {
            this.jsObject.options.forms["DigitalSignatureForm"].hide();
            this.jsObject.options.forms["DocumentSecurityForm"].hide();
        }
    }

    form.close = function () {
        this.hide();
        this.resetControls();
    };

    form.setPosition = function () {
        if (this.formName == "ExportForm") {
            body = document.getElementsByTagName('BODY')[0];
            scrollTop = document.documentElement.scrollTop == 0 ? body.scrollTop : document.documentElement.scrollTop;
            scrollLeft = document.documentElement.scrollLeft == 0 ? body.scrollLeft : document.documentElement.scrollLeft;
            documentHeight = document.documentElement.clientHeight == 0 ? body.clientHeight : document.documentElement.clientHeight;
            documentWidth = document.documentElement.clientWidth == 0 ? body.clientWidth : document.documentElement.clientWidth;
            this.style.left = (scrollLeft + documentWidth / 2 - this.offsetWidth / 2) + "px";
            this.style.top = (scrollTop + documentHeight / 2 - this.offsetHeight / 2) + "px";
        }
        else {
            this.style.left = (this.jsObject.options.forms["ExportForm"].offsetLeft + 70) + "px";
            this.style.top = (this.jsObject.options.forms["ExportForm"].offsetTop + 70) + "px";
        }
    }

    form.resetControls = function () {
        controls = this.jsObject.options.forms["ExportForm"].controls;
        exportFormatControlsString = this.jsObject.options.forms["ExportForm"].getAttribute(this.jsObject.options.forms["ExportForm"].exportFormat);
        exportFormatControls = exportFormatControlsString ? exportFormatControlsString.split(",") : [];
        for (var controlName in controls) {
            controls[controlName].changeVisibleState(this.jsObject.isContainted(exportFormatControls, controlName) &&
                !(controlName == "OpenAfterExport" && this.jsObject.options.forms["ExportForm"].action == this.jsObject.options.actionEmailReport))
            if ("reset" in controls[controlName]) {
                if (this.formName != "ExportForm") {
                    formControls = this.getAttribute("ControlsCollection").split(",");
                    if (this.jsObject.isContainted(formControls, controlName)) controls[controlName].reset();
                }
                else {
                    controls[controlName].reset();
                }
            }
        }
    }

    form.applySettings = function () {
        this.hide();
        controls = this.jsObject.options.forms["ExportForm"].controls;

        settings = {};
        settings["SaveReportFormat"] = controls["SaveReportMdc"].checked ? "Mdc" : (controls["SaveReportMdz"].checked ? "Mdz" : "Mdx");
        settings["SaveReportPassword"] = controls["PasswordSaveReport"].value;
        settings["PagesRange"] = controls["PagesRangeAll"].checked ? "All" : (controls["PagesRangeCurrentPage"].checked ? this.jsObject.options.pageNumber + 1 : controls["PagesRangePagesTextBox"].value);
        settings["OpenAfterExport"] = controls["OpenAfterExport"].getValue();
        settings["ImageQuality"] = controls["ImageQuality"].value / 100;
        settings["ImageResolution"] = controls["ImageResolution"].value;
        settings["EmbeddedFonts"] = controls["EmbeddedFonts"].getValue();
        settings["StandardPdfFonts"] = controls["StandardPDFFonts"].getValue();
        settings["Compressed"] = controls["Compressed"].getValue();
        settings["ExportRtfTextAsImage"] = controls["ExportRtfTextAsImage"].getValue();
        settings["PasswordInputUser"] = controls["UserPassword"].value;
        settings["PasswordInputOwner"] = controls["OwnerPassword"].value;
        settings["KeyLength"] = controls["EncryptionKeyLength"].value;
        settings["UseUnicode"] = controls["UseUnicode"].getValue();
        settings["UseDigitalSignature"] = controls["UseDigitalSignature"].getValue();
        settings["GetCertificateFromCryptoUI"] = controls["GetCertificateFromCryptoUI"].getValue();
        settings["SubjectNameString"] = controls["SubjectNameString"].value;
        settings["ImageCompressionMethod"] = controls["ImageCompressionMethod"].value;
        settings["AllowEditable"] = controls["AllowEditable"].value;
        settings["PdfACompliance"] = controls["PdfACompliance"].getValue();
        settings["Zoom"] = controls["Zoom"].value;
        settings["ImageZoom"] = controls["Zoom"].value;
        settings["UseEmbeddedImages"] = controls["EmbeddedImageData"].getValue();
        settings["CompressToArchive"] = controls["CompressToArchive"].getValue();
        settings["AddPageBreaks"] = controls["AddPageBreaks"].getValue();
        settings["ContinuousPages"] = controls["ContinuousPages"].getValue();
        settings["KillSpaceLines"] = controls["KillSpaceLines"].getValue();
        settings["PutFeedPageCode"] = controls["PutFeedPageCode"].getValue();
        settings["DrawBorder"] = controls["DrawBorder"].getValue();
        settings["CutLongLines"] = controls["CutLongLines"].getValue();
        settings["BorderType"] = controls["Simple"].checked ? "Simple" : (controls["UnicodeSingle"].checked ? "UnicodeSingle" : "UnicodeDouble");
        settings["ZoomX"] = controls["ZoomX"].value;
        settings["ZoomY"] = controls["ZoomY"].value;
        settings["UsePageHeadersAndFooters"] = controls["UsePageHeadersFooters"].getValue();
        settings["RemoveEmptySpaceAtBottom"] = controls["RemoveEmptySpace"].getValue();
        settings["ExportDataOnly"] = controls["ExportDataOnly"].getValue();
        settings["ExportObjectFormatting"] = controls["ExportObjectFormatting"].getValue();
        settings["UseOnePageHeaderAndFooter"] = controls["UseOnePageHeaderFooter"].getValue();
        settings["ExportEachPageToSheet"] = controls["ExportEachPageToSheet"].getValue();
        settings["ExportPageBreaks"] = controls["ExportPageBreaks"].getValue();
        settings["Separator"] = controls["Separator"].value;
        settings["SkipColumnHeaders"] = controls["SkipColumnHeaders"].getValue();
        settings["UseDefaultSystemEncoding"] = controls["UseDefaultSystemEncoding"].getValue();
        settings["CutEdges"] = controls["CutEdges"].getValue();
        settings["DitheringType"] = controls["MonochromeDitheringType"].value;
        settings["TiffCompressionScheme"] = controls["TiffCompressionScheme"].value;

        settings["UserAccessPrivileges"] = 0;
        if (controls["AllowPrintDocument"].getValue()) settings["UserAccessPrivileges"] += 1;
        if (controls["AllowModifyContents"].getValue()) settings["UserAccessPrivileges"] += 2;
        if (controls["AllowCopyTextAndGraphics"].getValue()) settings["UserAccessPrivileges"] += 4;
        if (controls["AllowAddOrModifyTextAnnotations"].getValue()) settings["UserAccessPrivileges"] += 8;
        
        settings["ImageFormat"] = controls["ImageFormat"].value;
        if (this.exportFormat == "Pdf" || this.exportFormat.indexOf("Image") == 0) settings["ImageFormat"] = controls["Color"].checked ? "Color" : (controls["Grayscale"].checked ? "Grayscale" : "Monochrome");

        settings["ExportMode"] = controls["ExportMode"].value;
        if (this.exportFormat == "Rtf") settings["ExportMode"] = controls["Table"].checked ? "Table" : "Frame";

        settings["Encoding"] = controls["EncodingTextOrCsvFile"].value;
        if (this.exportFormat == "Html" || this.exportFormat == "Html5" || this.exportFormat == "Mht") settings["Encoding"] = "utf-8";
        if (this.exportFormat == "Dif" || this.exportFormat == "Sylk") settings["Encoding"] = controls["EncodingDifFile"].value;

        settings["CodePage"] = controls["EncodingDbfFile"].value;
        if (this.exportFormat == "Rtf") settings["CodePage"] = 0;

        if (this.exportFormat.indexOf("Image") == 0) settings["ImageType"] = this.exportFormat.replace("Image", "");

        return settings;
    }

    form.setDefaultValues = function () {
        var allExportSettings = JSON.parse(this.jsObject.options.defaultExportSettings);
        var exportSettings = null;
        switch (this.exportFormat) {
            case "Pdf": { exportSettings = allExportSettings["StiPdfExportSettings"]; break; }
            case "Xps": { exportSettings = allExportSettings["StiXpsExportSettings"]; break; }
            case "Ppt2007": { exportSettings = allExportSettings["StiPpt2007ExportSettings"]; break; }
            case "Html": { exportSettings = allExportSettings["StiHtmlExportSettings"]; break; }
            case "Html5": { exportSettings = allExportSettings["StiHtml5ExportSettings"]; break; }
            case "Mht": { exportSettings = allExportSettings["StiMhtExportSettings"]; break; }
            case "Text": { exportSettings = allExportSettings["StiTxtExportSettings"]; break; }
            case "Rtf": { exportSettings = allExportSettings["StiRtfExportSettings"]; break; }
            case "Word2007": { exportSettings = allExportSettings["StiWord2007ExportSettings"]; break; }
            case "Odt": { exportSettings = allExportSettings["StiOdtExportSettings"]; break; }
            case "Excel": { exportSettings = allExportSettings["StiExcelExportSettings"]; break; }
            case "ExcelXml": { exportSettings = allExportSettings["StiExcelXmlExportSettings"]; break; }
            case "Excel2007": { exportSettings = allExportSettings["StiExcel2007ExportSettings"]; break; }
            case "Ods": { exportSettings = allExportSettings["StiOdsExportSettings"]; break; }
            case "ImageBmp": { exportSettings = allExportSettings["StiBmpExportSettings"]; break; }
            case "ImageGif": { exportSettings = allExportSettings["StiGifExportSettings"]; break; }
            case "ImageJpeg": { exportSettings = allExportSettings["StiJpegExportSettings"]; break; }
            case "ImagePcx": { exportSettings = allExportSettings["StiPcxExportSettings"]; break; }
            case "ImagePng": { exportSettings = allExportSettings["StiPngExportSettings"]; break; }
            case "ImageTiff": { exportSettings = allExportSettings["StiTiffExportSettings"]; break; }
            case "ImageSvg": { exportSettings = allExportSettings["StiSvgExportSettings"]; break; }
            case "ImageSvgz": { exportSettings = allExportSettings["StiSvgzExportSettings"]; break; }
            case "ImageEmf": { exportSettings = allExportSettings["StiEmfExportSettings"]; break; }
            case "Csv": { exportSettings = allExportSettings["StiCsvExportSettings"]; break; }
            case "Dbf": { exportSettings = allExportSettings["StiDbfExportSettings"]; break; }
            case "Dif": { exportSettings = allExportSettings["StiDifExportSettings"]; break; }
            case "Sylk": { exportSettings = allExportSettings["StiSylkExportSettings"]; break; }
        }
        if (exportSettings) this.jsObject.SetExportDefaultValues(exportSettings);
    }
}