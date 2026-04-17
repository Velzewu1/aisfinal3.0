
StiMvcViewer.prototype.SetExportDefaultValues = function (exportSettings) {
    var exportForm = this.options.forms["ExportForm"];
    var controls = exportForm.controls;

    if (exportSettings["PageRange"]) {
        if (exportSettings["PageRange"] == "All" && !controls["PagesRangeAll"].disabled) controls["PagesRangeAll"].onclick();
        else
            if (exportSettings["PageRange"].indexOf("-") == -1 && exportSettings["PageRange"].indexOf(",") == -1) controls["PagesRangeCurrentPage"].onclick();
            else { controls["PagesRangePages"].onclick(); controls["PagesRangePagesTextBox"].value = exportSettings["PageRange"]; }
    }

    if (exportSettings.DitheringType != null) controls["MonochromeDitheringType"].setValue(exportSettings.DitheringType);
    if (exportSettings.TiffCompressionScheme != null) controls["TiffCompressionScheme"].setValue(exportSettings.TiffCompressionScheme);
    if (exportSettings.CompressToArchive != null) controls["CompressToArchive"].checked = exportSettings.CompressToArchive;
    if (exportSettings.UseEmbeddedImages != null) controls["EmbeddedImageData"].checked = exportSettings.UseEmbeddedImages;
    if (exportSettings.ImageResolution != null) controls["ImageResolution"].setValue(exportSettings.ImageResolution);
    if (exportSettings.ImageCompressionMethod != null) controls["ImageCompressionMethod"].setValue(exportSettings.ImageCompressionMethod);
    if (exportSettings.AllowEditable != null) controls["AllowEditable"].setValue(exportSettings.AllowEditable);
    if (exportSettings.ImageQuality != null) controls["ImageQuality"].setValue(exportSettings.ImageQuality * 100, "%");
    if (exportSettings.Compressed != null) controls["Compressed"].checked = exportSettings.Compressed;
    if (exportSettings.ExportRtfTextAsImage != null) controls["ExportRtfTextAsImage"].checked = exportSettings.ExportRtfTextAsImage;
    if (exportSettings.PdfACompliance != null) { controls["PdfACompliance"].checked = exportSettings.PdfACompliance; controls["PdfACompliance"].onclick(); }
    if (exportSettings.StandardPdfFonts != null) controls["StandardPDFFonts"].checked = exportSettings.StandardPdfFonts;
    if (exportSettings.EmbeddedFonts != null) controls["EmbeddedFonts"].checked = exportSettings.EmbeddedFonts;
    if (exportSettings.UseUnicode != null) controls["UseUnicode"].checked = exportSettings.UseUnicode;
    if (exportSettings.PasswordInputUser != null) controls["UserPassword"].value = exportSettings.PasswordInputUser;
    if (exportSettings.PasswordInputOwner != null) controls["OwnerPassword"].value = exportSettings.PasswordInputOwner;
    if (exportSettings.KeyLength != null) controls["EncryptionKeyLength"].setValue(exportSettings.KeyLength);
    if (exportSettings.AddPageBreaks != null) controls["AddPageBreaks"].checked = exportSettings.AddPageBreaks;
    if (exportSettings.ContinuousPages != null) controls["ContinuousPages"].checked = exportSettings.ContinuousPages;
    if (exportSettings.KillSpaceLines != null) controls["KillSpaceLines"].checked = exportSettings.KillSpaceLines;
    if (exportSettings.PutFeedPageCode != null) controls["PutFeedPageCode"].checked = exportSettings.PutFeedPageCode;
    if (exportSettings.DrawBorder != null) controls["DrawBorder"].checked = exportSettings.DrawBorder;
    if (exportSettings.CutLongLines != null) controls["CutLongLines"].checked = exportSettings.CutLongLines;
    if (exportSettings.BorderType != null) if (controls[exportSettings.BorderType]) controls[exportSettings.BorderType].onclick();
    if (exportSettings.ZoomX != null) controls["ZoomX"].setValue(exportSettings.ZoomX.toString().replace(",", "."), "%");
    if (exportSettings.ZoomY != null) controls["ZoomY"].setValue(exportSettings.ZoomY.toString().replace(",", "."), "%");
    if (exportSettings.UseDigitalSignature != null) { controls["UseDigitalSignature"].checked = exportSettings.UseDigitalSignature; controls["UseDigitalSignature"].onclick(); }
    if (exportSettings.SubjectNameString != null) controls["SubjectNameString"].value = exportSettings.SubjectNameString;
    if (exportSettings.Zoom != null) controls["Zoom"].setValue(exportSettings.Zoom.toString().replace(",", "."), "%");
    if (exportSettings.UsePageHeadersAndFooters != null) controls["UsePageHeadersFooters"].checked = exportSettings.UsePageHeadersAndFooters;
    if (exportSettings.RemoveEmptySpaceAtBottom != null) controls["RemoveEmptySpace"].checked = exportSettings.RemoveEmptySpaceAtBottom;
    if (exportSettings.ExportDataOnly != null) { controls["ExportDataOnly"].checked = exportSettings.ExportDataOnly; controls["ExportDataOnly"].onclick(); }
    if (exportSettings.ExportObjectFormatting != null) controls["ExportObjectFormatting"].checked = exportSettings.ExportObjectFormatting;
    if (exportSettings.UseOnePageHeaderAndFooter != null) controls["UseOnePageHeaderFooter"].checked = exportSettings.UseOnePageHeaderAndFooter;
    if (exportSettings.ExportEachPageToSheet != null) controls["ExportEachPageToSheet"].checked = exportSettings.ExportEachPageToSheet;
    if (exportSettings.ExportPageBreaks != null) controls["ExportPageBreaks"].checked = exportSettings.ExportPageBreaks;
    if (exportSettings.SkipColumnHeaders != null) controls["SkipColumnHeaders"].checked = exportSettings.SkipColumnHeaders;
    if (exportSettings.Separator != null) controls["Separator"].value = exportSettings.Separator;
    if (exportSettings.ImageZoom != null) controls["Zoom"].setValue(exportSettings.ImageZoom.toString().replace(",", "."), "%");
    if (exportSettings.CutEdges != null) controls["CutEdges"].checked = exportSettings.CutEdges;
    if (exportSettings.MultipleFiles != null) controls["MultipleFiles"].checked = exportSettings.MultipleFiles;
    if (exportSettings.CodePage != null) controls["EncodingDbfFile"].setValue(exportSettings.CodePage);
    if (exportSettings.UseDefaultSystemEncoding != null) { controls["UseDefaultSystemEncoding"].checked = exportSettings.UseDefaultSystemEncoding; controls["UseDefaultSystemEncoding"].onclick(); }

    if (exportSettings.Encoding != null) {        
        if (exportForm.exportFormat == "Dif" || exportForm.exportFormat == "Sylk") controls["EncodingDifFile"].setValue(exportSettings.Encoding);
        else controls["EncodingTextOrCsvFile"].setValue(exportSettings.Encoding);
    }

    if (exportSettings.ImageFormat != null) {
        if (exportForm.exportFormat == "Html" || exportForm.exportFormat == "Mht" || exportForm.exportFormat == "Html5") controls["ImageFormat"].setValue(exportSettings.ImageFormat);
        else if (controls[exportSettings.ImageFormat]) controls[exportSettings.ImageFormat].onclick();
    }

    if (exportSettings.UserAccessPrivileges != null) {
        controls["AllowPrintDocument"].checked = exportSettings.UserAccessPrivileges.indexOf("PrintDocument") != -1 || exportSettings.UserAccessPrivileges == "All";
        controls["AllowModifyContents"].checked = exportSettings.UserAccessPrivileges.indexOf("ModifyContents") != -1 || exportSettings.UserAccessPrivileges == "All";
        controls["AllowCopyTextAndGraphics"].checked = exportSettings.UserAccessPrivileges.indexOf("CopyTextAndGraphics") != -1 || exportSettings.UserAccessPrivileges == "All";
        controls["AllowAddOrModifyTextAnnotations"].checked = exportSettings.UserAccessPrivileges.indexOf("AddOrModifyTextAnnotations") != -1 || exportSettings.UserAccessPrivileges == "All";
    }

    if (exportSettings.GetCertificateFromCryptoUI != null) {
        controls["GetCertificateFromCryptoUI"].checked = exportSettings.GetCertificateFromCryptoUI;
        if (!controls["GetCertificateFromCryptoUI"].disabled) controls["GetCertificateFromCryptoUI"].onclick();
    }

    if (exportSettings.ExportMode != null) {
        if (exportForm.exportFormat == "Html" || exportForm.exportFormat == "Mht") controls["ExportMode"].setValue(exportSettings.ExportMode);
        if (exportForm.exportFormat == "Rtf") if (controls[exportSettings.ExportMode]) controls[exportSettings.ExportMode].onclick();
    }
}