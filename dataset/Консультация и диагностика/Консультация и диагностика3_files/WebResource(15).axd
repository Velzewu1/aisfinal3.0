
StiMvcViewer.prototype.InitializeExportGroupBox = function (groupBox) {
    groupBox.jsObject = this;
    groupBox.groupBoxName = groupBox.getAttribute("groupBoxName");
    groupBox.parentFormName = groupBox.getAttribute("parentFormName");

    groupBox.parentForm = document.getElementById(this.options.mvcViewer.id + "ExportForm");
    if (groupBox.parentForm) {
        if (!groupBox.parentForm.controls) groupBox.parentForm.controls = new Object();
        groupBox.parentForm.controls[groupBox.groupBoxName] = groupBox;
    }

    groupBox.changeVisibleState = function (state) {
        this.style.display = state ? "" : "none";
        if (this.groupBoxName == "ZoomGroupBox" || this.groupBoxName == "BorderTypeGroupBox" ||
            this.groupBoxName == "ImageTypeGroupBox" || this.groupBoxName == "ExportModeGroupBox")
            this.parentElement.style.display = state ? "" : "none";
    }
}