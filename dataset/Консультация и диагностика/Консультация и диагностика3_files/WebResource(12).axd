
StiMvcViewer.prototype.InitializeExportRadioButton = function (radioButton) {
    radioButton.jsObject = this;
    radioButton.parentTable = document.getElementById(radioButton.id + "ParentTable");
    radioButton.parentTable.rows[0].cells[1].radioButton = radioButton;
    radioButton.radioButtonName = radioButton.parentTable.getAttribute("radioButtonName");
    radioButton.groupName = radioButton.parentTable.getAttribute("groupName");
        
    radioButton.parentForm = document.getElementById(this.options.mvcViewer.id + "ExportForm");
    if (!radioButton.parentForm.controls) radioButton.parentForm.controls = new Object();
    radioButton.parentForm.controls[radioButton.radioButtonName] = radioButton;

    radioButton.setCheckedState = function (state) {
        if (state)
            for (var index in this.parentForm.controls) {
                groupName = this.parentForm.controls[index].groupName;
                if (groupName)
                    if (groupName == this.groupName) this.parentForm.controls[index].setCheckedState(false);
            }

        this.checked = state;
    }

    radioButton.setEnabledState = function (state) {
        this.parentTable.className = state ? "stiEnabledExportControl" : "stiDisabledExportControl";
        this.disabled = !state
        if (!state) this.setCheckedState(false);
    }

    radioButton.reset = function () {
        if (this.groupName != "PagesRange") {
            this.checked = (this.parentTable.getAttribute("defaultChecked") == "True" || this.parentTable.getAttribute("defaultChecked") == "true");
            if (this.radioButtonName == "Monochrome") {
                var exportFormat = this.parentForm.exportFormat;
                this.setEnabledState(exportFormat != "ImageEmf" && exportFormat != "ImageSvg" && exportFormat != "ImageSvgz");
                return;
            }
            this.setEnabledState(this.parentTable.getAttribute("defaultEnabled") == "True" || this.parentTable.getAttribute("defaultEnabled") == "true");

        }
        else {
            imageFormats = ["ImageBmp", "ImageGif", "ImageJpeg", "ImagePcx", "ImagePng", "ImageTiff", "ImageEmf", "ImageSvg", "ImageSvgz"];

            if (this.radioButtonName == "PagesRangeAll") {
                this.setEnabledState(!(this.jsObject.isContainted(imageFormats, this.parentForm.exportFormat) && this.parentForm.exportFormat != "ImageTiff"));
                this.setCheckedState(!this.disabled);
            }
            if (this.radioButtonName == "PagesRangeCurrentPage") {
                this.setEnabledState(this.jsObject.options.menuViewMode == "OnePage");
                this.setCheckedState(!this.disabled && !this.parentForm.controls["PagesRangeAll"].checked);
            }
            if (this.radioButtonName == "PagesRangePages") {
                this.setEnabledState(true);
                if (!this.disabled && !this.parentForm.controls["PagesRangeAll"].checked && !this.parentForm.controls["PagesRangeCurrentPage"].checked)
                    this.onclick();
            }
        }
    }

    radioButton.changeVisibleState = function (state) {
        this.parentTable.style.display = state ? "" : "none";
    }

    radioButton.onclick = function () {
        this.setCheckedState(true);
        if (this.groupName == "PagesRange") {
            this.parentForm.controls["PagesRangePagesTextBox"].setEnabledState(this.radioButtonName == "PagesRangePages");
            this.parentForm.controls["PagesRangePagesTextBox"].value = "";
            if (this.radioButtonName == "PagesRangePages") this.parentForm.controls["PagesRangePagesTextBox"].focus();
        }
        if (this.groupName == "SaveReport") {
            this.parentForm.controls["PasswordSaveReport"].setEnabledState(this.radioButtonName == "SaveReportMdx");
            this.parentForm.controls["PasswordSaveReport"].value = "";
            if (this.radioButtonName == "SaveReportMdx") this.parentForm.controls["PasswordSaveReport"].focus();
        }
        if (this.groupName == "ImageTypeGroupBox") {
            this.parentForm.controls["MonochromeDitheringType"].setEnabledState(this.radioButtonName == "Monochrome");
        }
    }

    radioButton.parentTable.rows[0].cells[1].onclick = function () {
        if (this.radioButton.disabled) return;
        this.radioButton.setCheckedState(true);
        radioButton.onclick();
    }
}