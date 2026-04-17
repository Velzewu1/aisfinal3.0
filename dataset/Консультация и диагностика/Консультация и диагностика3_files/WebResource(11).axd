
StiMvcViewer.prototype.InitializeExportCheckBox = function (checkBox) {
    checkBox.jsObject = this;
    checkBox.parentTable = document.getElementById(checkBox.id + "ParentTable");
    checkBox.parentTable.rows[0].cells[1].checkBox = checkBox;
    checkBox.checkBoxName = checkBox.parentTable.getAttribute("checkBoxName");

    checkBox.parentForm = document.getElementById(this.options.mvcViewer.id + "ExportForm");
    if (!checkBox.parentForm.controls) checkBox.parentForm.controls = new Object();
    checkBox.parentForm.controls[checkBox.checkBoxName] = checkBox;

    checkBox.reset = function () {
        this.checked = (this.parentTable.getAttribute("defaultChecked") == "True" || this.parentTable.getAttribute("defaultChecked") == "true");
        this.setEnabledState(this.parentTable.getAttribute("defaultEnabled") == "True" || this.parentTable.getAttribute("defaultEnabled") == "true");
    }

    checkBox.setEnabledState = function (state) {
        this.parentTable.className = state ? "stiEnabledExportControl" : "stiDisabledExportControl";
        this.disabled = !state
    }

    checkBox.changeVisibleState = function (state) {
        this.parentTable.style.display = state ? "" : "none";
    }

    checkBox.getValue = function () {
        return !this.disabled ? this.checked : false;
    }

    checkBox.onclick = function () {
        if (this.checkBoxName == "PdfACompliance") {
            this.parentForm.controls["StandardPDFFonts"].setEnabledState(!this.checked);
            this.parentForm.controls["EmbeddedFonts"].setEnabledState(!this.checked);
            this.parentForm.controls["UseUnicode"].setEnabledState(!this.checked);
        }
        if (this.checkBoxName == "UseDigitalSignature") {
            this.parentForm.controls["GetCertificateFromCryptoUI"].setEnabledState(this.checked);
            this.parentForm.controls["SubjectNameString"].setEnabledState(!this.checked ? false : !this.parentForm.controls["GetCertificateFromCryptoUI"].checked);
        }
        if (this.checkBoxName == "GetCertificateFromCryptoUI") { this.parentForm.controls["SubjectNameString"].setEnabledState(!this.checked); }
        if (this.checkBoxName == "ExportDataOnly") {
            this.parentForm.controls["ExportObjectFormatting"].setEnabledState(this.checked);
            this.parentForm.controls["UseOnePageHeaderFooter"].setEnabledState(!this.checked);
        }
        if (this.checkBoxName == "UseDefaultSystemEncoding") { this.parentForm.controls["EncodingDifFile"].setEnabledState(!this.checked); }
    }

    checkBox.parentTable.rows[0].cells[1].onclick = function () {
        if (this.checkBox.disabled) return;
        this.checkBox.checked = !this.checkBox.checked;
        checkBox.onclick();
    }
}