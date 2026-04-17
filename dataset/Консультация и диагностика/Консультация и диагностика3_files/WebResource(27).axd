
StiMvcViewer.prototype.InitializeSendEmailForm = function (form) {
    this.InitializeForm(form);
    form.attachmentCell = document.getElementById(this.options.mvcViewer.id + "SendEmailFormAttachmentCell");

    form.onshow = function () {
        for (var i in this.controls) {
            this.controls[i].reset();
        }

        this.controls["Email"].value = this.jsObject.options.defaultEmailAddress;
        this.controls["Message"].value = this.jsObject.options.defaultEmailMessage;
        this.controls["Subject"].value = this.jsObject.options.defaultEmailSubject;

        var ext = this.exportFormat.toLowerCase().replace("image", "");
        switch (ext)
		{
			case "excel": ext = "xls"; break;
			case "excel2007": ext = "xlsx"; break;
			case "excelxml": ext = "xls"; break;
			case "html5": ext = "html"; break;
			case "jpeg": ext = "jpg"; break;
			case "ppt2007": ext = "ppt"; break;
			case "text": ext = "txt"; break;
			case "word2007": ext = "docx"; break;
		}
	    
        this.attachmentCell.innerHTML = this.jsObject.options.reportFileName + "." + ext;
    }

    form.applySettings = function () {
        this.hide();

        this.exportSettings["Email"] = this.controls["Email"].value;
        this.exportSettings["Subject"] = this.controls["Subject"].value;
        this.exportSettings["Message"] = this.controls["Message"].value;

        return this.exportSettings;
    }
}