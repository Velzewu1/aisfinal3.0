
StiMvcViewer.prototype.InitializeProcessImage = function (processImage) {
    processImage.jsObject = this;
    this.options.processImage = processImage;

    processImage.show = function () {
        this.style.display = "";
        this.style.left = (processImage.jsObject.options.mvcViewer.offsetWidth / 2 - this.offsetWidth / 2) + "px";
        this.style.top = (processImage.jsObject.options.mvcViewer.offsetHeight < 200 && processImage.jsObject.options.pagesCount > 0)
            ? (processImage.jsObject.options.mvcViewer.offsetHeight / 2 - this.offsetHeight / 2) + "px"
            : "200px";
    }

    processImage.hide = function () {
        this.style.display = "none";
    }
}