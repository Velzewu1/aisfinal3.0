
StiMvcViewer.prototype.InitializeExportDropDownList = function (dropDownList) {
    dropDownList.jsObject = this;
    dropDownList.parentTable = document.getElementById(dropDownList.id + "ParentTable");
    dropDownList.dropDownListName = dropDownList.parentTable.getAttribute("dropDownListName");

    dropDownList.parentForm = document.getElementById(this.options.mvcViewer.id + "ExportForm");
    if (!dropDownList.parentForm.controls) dropDownList.parentForm.controls = new Object();
    dropDownList.parentForm.controls[dropDownList.dropDownListName] = dropDownList;

    dropDownList.setEnabledState = function (state) {
        this.parentTable.className = state ? "stiEnabledExportControl" : "stiDisabledExportControl";
        this.disabled = !state
    }

    dropDownList.reset = function () {
        var defaultIndexItem = this.parentTable.getAttribute("defaultIndexItem");
        if (this.options[defaultIndexItem]) this.value = this.options[defaultIndexItem].value;
        if (this.dropDownListName == "TiffCompressionScheme") { this.setEnabledState(this.parentForm.controls["ImageType"].value == "ImageTiff"); return; }
        this.setEnabledState(this.parentTable.getAttribute("defaultEnabled") == "True" || this.parentTable.getAttribute("defaultEnabled") == "true");

        //Exceptions
        if (this.parentForm.exportFormat == "Csv" && this.dropDownListName == "EncodingTextOrCsvFile") { this.value = this.options[0].value; return; }
        if (this.dropDownListName == "HTMLType" ||
            this.dropDownListName == "ExcelType" ||
            this.dropDownListName == "ImageType" ||
            this.dropDownListName == "DataType") {
            this.value = this.parentForm.exportFormat;
            return;
        }
    }

    dropDownList.setValue = function (value, unit) {
        this.value = value;
        if (this.value == "") {
            this.options[this.options.length] = new Option(value + (unit ? unit : ""), value);
            this.value = value;
        }
    }

    dropDownList.changeVisibleState = function (state) {
        this.parentTable.style.display = state ? "" : "none";
    }

    dropDownList.onchange = function () {
        var exportFormat = this.parentForm.exportFormat;
        var name = this.dropDownListName;

        if (name == "HTMLType" || name == "ExcelType" || name == "DataType" || name == "ImageType") {
            this.parentForm.exportFormat = this.value;
            this.parentForm.resetControls();
            this.parentForm.setDefaultValues();
            return;
        }
    }
}