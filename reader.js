//reader class 

function Reader(str) {
    this.data = str;
    this.curr_pos = 0;
    this.data_length = str.length;
}

Reader.prototype.nextChar = function () {
    if (this.curr_pos >= this.data_length) {
        return -1; //end of string stream
    }

    return this.data[this.curr_pos++];
}

//back n characters
Reader.prototype.retract = function (n) {
    if (n == undefined) {
        n = 1;
    }

    this.curr_pos -= n;

    if (this.curr_pos < 0) {
        this.curr_pos = 0;
    }
}


function log(str) {
    $("#log").append(str + "<br />");
}

$(function () {
    //stored in <script id="jj">
    var data_to_compiled = $("#jj").text();
    var reader = new Reader(data_to_compiled);
    var retracted = false;

    while (true) {
        var next_char = reader.nextChar();
        if (next_char == -1) {
            break;
        }


        //if meets '!' token , will retract once
        if (next_char == "!" && !retracted) {
            reader.retract();
            retracted = true;
        }
        log("char: " + next_char);
    }
});