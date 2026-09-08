on run argv
    set argc to count of argv
    if argc is less than 3 then
        error "Usage: osascript run_macro_export.applescript <input-pptm> <macro-name> [macro-param ...] <output-pdf>"
    end if

    set inputPosixPath to item 1 of argv
    set inPptm to POSIX file inputPosixPath
    set macroName to item 2 of argv
    set outPdf to POSIX file (item argc of argv)

    set macroParams to {}
    if argc is greater than 3 then
        set macroParams to items 3 thru (argc - 1) of argv
    end if

    set openedPresentation to missing value
    tell application "Microsoft PowerPoint"
        try
            open inPptm
            set presentationPaths to (get full name of every presentation)
            repeat with presentationIndex from 1 to count of presentationPaths
                if (item presentationIndex of presentationPaths as text) is inputPosixPath then
                    set openedPresentation to presentation presentationIndex
                    exit repeat
                end if
            end repeat
            if openedPresentation is missing value then
                error "PowerPoint opened the macro host but no presentation matched: " & inputPosixPath
            end if
            set macroInvocationName to macroName
            if macroName does not contain "!" then
                set macroInvocationName to (name of openedPresentation) & "!" & macroName
            end if
            run VB macro macro name macroInvocationName list of parameters macroParams
            save openedPresentation in outPdf as save as PDF
            close openedPresentation saving no
        on error errorMessage number errorNumber
            if openedPresentation is not missing value then
                try
                    close openedPresentation saving no
                end try
            end if
            error errorMessage number errorNumber
        end try
    end tell
end run
