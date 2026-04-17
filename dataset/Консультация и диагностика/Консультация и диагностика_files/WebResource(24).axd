
StiMvcViewer.prototype.AddControl = function (id, type) {
    control = document.getElementById(id);

    switch (type) {
        case "Menu": this.InitializeMenu(control); break;
        case "MenuItem": this.InitializeMenuItem(control); break;
        case "Button": this.InitializeToolButton(control); break;
        case "ReportPanel": this.InitializeReportPanel(control); break;
        case "ToolBar": this.InitializeToolBar(control); break;
        case "ExportForm":
        case "DigitalSignatureForm":
        case "DocumentSecurityForm": this.InitializeExportForm(control); break;
        case "SendEmailForm": this.InitializeSendEmailForm(control); break; 
        case "ExportCheckBox": this.InitializeExportCheckBox(control); break;
        case "ExportRadioButton": this.InitializeExportRadioButton(control); break;
        case "ExportDropDownList": this.InitializeExportDropDownList(control); break;
        case "ExportTextBox": this.InitializeExportTextBox(control); break;
        case "ExportGroupBox": this.InitializeExportGroupBox(control); break;
        case "ParametersPanel": this.InitializeParametersPanel(control); break;
        case "BookmarksPanel": this.InitializeBookmarksPanel(control); break;
        case "ProcessImage": this.InitializeProcessImage(control); break;
        case "DatePicker": this.InitializeDatePicker(control); break;
    }
}