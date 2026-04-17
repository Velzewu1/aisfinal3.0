
StiMvcViewer.prototype.InitializeForm = function (form) {
    form.jsObject = this;
    form.formName = form.getAttribute("formName");
    this.options.forms[form.formName] = form;
    form.header = document.getElementById(form.id + "Header");
    form.disabledPanel = document.getElementById(form.id + "DisabledPanel");
    form.viewerDisabledPanel = document.getElementById(this.options.mvcViewer.id + "DisabledPanel");
    form.header.thisForm = form;
    form.inDrag = false;

    form.onshow = function () { };
    form.onhide = function () { };
    form.close = function () {
        this.hide();
    };

    form.show = function () {
        this.onshow();
        this.style.display = "";
        this.setPosition();
        this.viewerDisabledPanel.style.display = "";
    }

    form.hide = function () {
        this.onhide();
        this.style.display = "none";
        this.viewerDisabledPanel.style.display = "none";
    }

    form.setEnabled = function (state) {
        this.disabledPanel.style.display = !state ? "" : "none";
    }

    form.setPosition = function () {
        body = document.getElementsByTagName('BODY')[0];
        scrollTop = document.documentElement.scrollTop == 0 ? body.scrollTop : document.documentElement.scrollTop;
        scrollLeft = document.documentElement.scrollLeft == 0 ? body.scrollLeft : document.documentElement.scrollLeft;
        documentHeight = document.documentElement.clientHeight == 0 ? body.clientHeight : document.documentElement.clientHeight;
        documentWidth = document.documentElement.clientWidth == 0 ? body.clientWidth : document.documentElement.clientWidth;
        this.style.left = (scrollLeft + documentWidth / 2 - this.offsetWidth / 2) + "px";
        this.style.top = (scrollTop + documentHeight / 2 - this.offsetHeight / 2) + "px";
    }

    //Mouse Events
    form.header.onmousedown = function (event) {
        if (!event) return;
        form = this.thisForm;
        document.onmouseup = function () { form.inDrag = false };
        document.onmousemove = function (event) { form.move(form, event); };
        mouseStartX = event.clientX;
        mouseStartY = event.clientY;
        formStartX = this.thisForm.jsObject.FindPosX(this.thisForm, "stiMainPanel");
        formStartY = this.thisForm.jsObject.FindPosY(this.thisForm, "stiMainPanel");
        this.thisForm.inDrag = [mouseStartX, mouseStartY, formStartX, formStartY];
    }

    form.move = function (form, evnt) {
        if (!form.isDisable) {
            mouseCurrentX = evnt.clientX;
            mouseCurrentY = evnt.clientY;
            form.style.left = form.inDrag[2] + (mouseCurrentX - form.inDrag[0]) + "px";
            form.style.top = form.inDrag[3] + (mouseCurrentY - form.inDrag[1]) + "px";
        }
    }
}