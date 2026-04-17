
//Button
StiMvcViewer.prototype.parameterButton = function (buttonType, parameter) {
    button = document.createElement("Div");
    button.parameter = parameter;
    button.buttonType = buttonType;
    button.isDisable = false;

    button.style.height = "22px";
    button.style.width = "22px";
    button.className = "sti" + buttonType;

    button.setEnabledState = function (state) {
        this.isDisable = !state;
        this.className = "sti" + buttonType + (state ? "" : "Disabled");
    }

    button.onmouseover = function () { if (!this.isDisable) this.className = "sti" + this.buttonType + "Over"; }
    button.onmouseout = function () { if (!this.isDisable) this.className = "sti" + this.buttonType; }

    return button;
}

//TextBox
StiMvcViewer.prototype.parameterTextBox = function (parameter) {
    textBox = document.createElement("Input");
    textBox.className = "stiParametersTextBoxes";
    textBox.parameter = parameter;
    if (parameter.params.type == "Char") textBox.maxLength = 1;

    if (textBox.parameter.basicType == "Range") {
        textBox.style.width = "120px";
        if (textBox.parameter.type == "Guid" || textBox.parameter.type == "String") textBox.style.width = "160px";
        if (textBox.parameter.type == "DateTime") textBox.style.width = "130px";
        if (textBox.parameter.type == "Char") textBox.style.width = "50px";
    }
    else {
        if (textBox.parameter.type == "Guid") textBox.style.width = "235px"; else textBox.style.width = "180px";
    }

    textBox.setEnabledState = function (state) {
        this.disabled = !state;
    }

    textBox.setReadOnlyState = function (state) {
        this.readOnly = state;
        this.className = state ? "stiParametersTextBoxesReadOnly" : "stiParametersTextBoxes";
        this.setAttribute("unselectable", state ? "on" : "off");
        this.setAttribute("onselectstart", state ? "return false" : "");
    }

    return textBox;
}

//CheckBox
StiMvcViewer.prototype.parameterCheckBox = function (parameter) {
    checkBox = document.createElement("Input");
    checkBox.parameter = parameter;
    checkBox.setAttribute("type", "checkbox");
    checkBox.style.marginLeft = "0px";

    checkBox.setEnabledState = function (state) {
        this.disabled = !state;
    }

    return checkBox;
}