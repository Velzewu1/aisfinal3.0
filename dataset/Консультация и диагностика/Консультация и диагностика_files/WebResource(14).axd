
StiMvcViewer.prototype.InitializeExportTextBox = function (textBox) {
    textBox.jsObject = this;
    textBox.parentTable = document.getElementById(textBox.id + "ParentTable");
    textBox.textBoxName = textBox.parentTable.getAttribute("textBoxName");
    textBox.parentFormName = textBox.parentTable.getAttribute("parentFormName");

    textBox.parentForm = document.getElementById(this.options.mvcViewer.id + textBox.parentFormName);
    if (textBox.parentForm) {        
        if (!textBox.parentForm.controls) textBox.parentForm.controls = new Object();
        textBox.parentForm.controls[textBox.textBoxName] = textBox;
    }

    textBox.setEnabledState = function (state) {
        this.parentTable.className = state ? "stiEnabledExportControl" : "stiDisabledExportControl";
        this.disabled = !state;
    }

    textBox.reset = function () {
        this.value = this.parentTable.getAttribute("defaultValue");
        this.setEnabledState(this.parentTable.getAttribute("defaultEnabled") == "True" || this.parentTable.getAttribute("defaultEnabled") == "true");
    }

    textBox.changeVisibleState = function (state) {
        this.parentTable.style.display = state ? "" : "none";
    }
}