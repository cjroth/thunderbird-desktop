# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Build the macOS redesign from a matching Daily bundle and Thunderbolt XPI."""

from collections import defaultdict
import argparse
import configparser
import difflib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

SOURCE = Path(__file__).resolve().parents[2]
ARCHIVE = Path("Contents/Resources/omni.ja")
BASE = "96f00473cd827b2ebbbe7028f288600fcad9f3ba"
DAILY = "66c997fa60f21ccfdfff4f7c45c800b4720b09df"
ADDON_ID = "thunderbolt-panel@thunderbird.net"
DISTRIBUTION_XPI = Path("Contents/Resources/distribution/extensions") / (ADDON_ID + ".xpi")
MODULE_DIR = "mailnews/db/gloda/modules/"
SEMANTIC_MODULES = (
    "GlodaSemanticCandidates.sys.mjs",
    "GlodaSemanticReranker.sys.mjs",
    "GlodaSemanticReranker.worker.mjs",
)


MESSENGER = "chrome/messenger/content/messenger/messenger.xhtml"
BRANDING = "mail/branding/thunderbird/"
INCLUDES = {
    "calendar/base/content/calendar-tab-panels.inc.xhtml": MESSENGER,
    "calendar/base/content/calendar-today-pane.inc.xhtml": MESSENGER,
    "mail/base/content/spacesToolbar.inc.xhtml": MESSENGER,
    "mail/components/customizableui/content/panelUI.inc.xhtml": MESSENGER,
    "mail/components/unifiedtoolbar/content/unifiedToolbarTemplates.inc.xhtml": MESSENGER,
    "mail/base/content/msgHdrView.inc.xhtml": "chrome/messenger/content/messenger/aboutMessage.xhtml",
    "mail/components/preferences/appearance.inc.xhtml": "chrome/messenger/content/messenger/preferences/preferences.xhtml",
    "mail/base/content/templates/messagePaneTemplate.inc.xhtml": "chrome/messenger/content/messenger/about3Pane.xhtml",
}


def git(*args, source=SOURCE):
    return subprocess.check_output(["git", *args], cwd=source)


def overlay(source_path, before, after, packaged, *, context=6):
    """Apply edit hunks to preprocessed resources, rejecting ambiguous contexts."""
    if source_path.endswith("all-thunderbird.js"):
        before = [line for line in before.splitlines(True) if line.startswith(b"pref(")]
        after = [line for line in after.splitlines(True) if line.startswith(b"pref(")]
        context = 0
    else:
        before = [line for line in before.splitlines(True) if not line.startswith(b"#")]
        after = [line for line in after.splitlines(True) if not line.startswith(b"#")]
    matcher = difflib.SequenceMatcher(a=before, b=after, autojunk=False)
    for group in matcher.get_grouped_opcodes(context):
        old = b"".join(before[group[0][1]:group[-1][2]])
        new = b"".join(after[group[0][3]:group[-1][4]])
        if not old and source_path.endswith("all-thunderbird.js") and group[0][1]:
            old = before[group[0][1] - 1]
            new = old + new
        if old and packaged.count(old) != 1 and source_path.endswith(".xhtml"):
            # An include within the surrounding context expands into more lines
            # in the shipped document. Trim only unchanged lines around the edit.
            first, last = group[0], group[-1]
            left_context = first[2] - first[1] if first[0] == "equal" else 0
            right_context = last[2] - last[1] if last[0] == "equal" else 0
            trims = sorted(
                (left + right, left, right)
                for left in range(left_context + 1)
                for right in range(right_context + 1)
            )
            for _, left, right in trims:
                section = b"".join(before[first[1] + left:last[2] - right])
                if section and packaged.count(section) == 1:
                    old = section
                    new = b"".join(after[first[3] + left:last[4] - right])
                    break
        if not old or packaged.count(old) != 1:
            # Adjacent edits can straddle an expanded include. Split just this
            # group into smaller hunks and keep requiring a unique match.
            if source_path.endswith(".xhtml") and context and sum(
                op[0] != "equal" for op in group
            ) > 1:
                packaged = overlay(source_path, old, new, packaged, context=context // 2)
                continue
            raise ValueError(f"Cannot apply this source hunk uniquely: {source_path}\n{old.decode()}")
        packaged = packaged.replace(old, new, 1)
    return packaged


def get_entries(pristine, *, source=SOURCE, base=BASE, packaged_base=None,
                includes=INCLUDES, new_resources=None, manifests=()):
    names = defaultdict(list)
    for item in pristine.namelist():
        names[Path(item).name].append(item)
    changed = git("diff", "--name-only", "-z", base, "--", ".", ":(exclude)tools/desktop-redesign/**", source=source).decode().split("\0")
    entries = {}
    for path in filter(None, changed):
        if "/test/" in path or "/tests/" in path or path in manifests:
            continue
        if new_resources and path in new_resources:
            entries[new_resources[path]] = (source / path).read_bytes()
            continue
        if path.startswith(BRANDING):
            filename = path.removeprefix(BRANDING)
            if filename.startswith("content/"):
                resource = "chrome/messenger/content/branding/" + Path(filename).name
            elif filename in {f"default{size}.png" for size in (32, 48, 64, 128, 256)}:
                resource = "chrome/messenger/content/branding/" + filename.replace("default", "icon", 1)
            elif filename in ("thunderbird.icns", "messengerWindow.ico", "default16.png", "default22.png", "default24.png"):
                continue
            else:
                raise ValueError(f"Unknown branding asset: {path}")
            if resource not in pristine.namelist():
                raise ValueError(f"Missing branding asset in release: {resource}")
            entries[resource] = (source / path).read_bytes()
            continue
        before = git("show", (packaged_base or base) + ":" + path, source=source)
        after = (source / path).read_bytes()
        candidates = names[Path(path).name]
        matches = [name for name in candidates if pristine.read(name) == before]
        if matches:
            for name in matches:
                entries[name] = after
            continue
        if path in includes:
            name = includes[path]
        elif path.startswith("mail/locales/en-US/") and path.endswith(".ftl"):
            name = path.replace("mail/locales/en-US/", "localization/en-US/", 1)
        elif len(candidates) == 1:
            name = candidates[0]
        else:
            mail = [name for name in candidates if name.startswith("chrome/messenger/")]
            if len(mail) != 1:
                raise ValueError(f"Cannot locate shipped resource for {path}: {candidates}")
            name = mail[0]
        current = entries.get(name, pristine.read(name))
        entries[name] = overlay(path, before, after, current)
    return entries


def package(daily, xpi, output):
    metadata = configparser.ConfigParser()
    metadata.read(daily / "Contents/Resources/application.ini")
    if metadata["App"]["BuildID"] != "20261123091859" or metadata["App"]["Version"] != "163.0a1":
        raise SystemExit("Provide Thunderbird Daily 163.0a1, build 20261123091859.")
    with zipfile.ZipFile(xpi) as addon:
        manifest = json.loads(addon.read("manifest.json"))
        if manifest["browser_specific_settings"]["gecko"]["id"] != ADDON_ID or addon.testzip():
            raise SystemExit("The input must be the Thunderbolt integration XPI.")
    if output.resolve() == daily.resolve():
        raise SystemExit("Choose a separate output path for the preview.")
    if output.exists():
        raise SystemExit(f"Choose a new output path; {output} already exists.")

    module_manifest = MODULE_DIR + "moz.build"
    declarations = (SOURCE / module_manifest).read_text()
    for name in SEMANTIC_MODULES:
        if f'"{name}"' not in declarations:
            raise ValueError(f"{name} is missing from the Thunderbird build manifest.")
    includes = {
        **INCLUDES,
        "mail/base/content/messenger-menubar.inc.xhtml": MESSENGER,
        "mail/base/content/spacesToolbarPin.inc.xhtml": MESSENGER,
        "mail/components/preferences/compose.inc.xhtml":
            "chrome/messenger/content/messenger/preferences/preferences.xhtml",
        "mail/components/preferences/general.inc.xhtml":
            "chrome/messenger/content/messenger/preferences/preferences.xhtml",
    }
    with tempfile.TemporaryDirectory(prefix=".thunderbolt-package-", dir=output.parent) as scratch:
        stage = Path(scratch) / output.name
        shutil.copytree(daily, stage, symlinks=True)
        with zipfile.ZipFile(daily / ARCHIVE) as pristine:
            resources = get_entries(
                pristine, source=SOURCE, base=BASE, packaged_base=DAILY, includes=includes,
                new_resources={MODULE_DIR + n: "modules/gloda/" + n for n in SEMANTIC_MODULES},
                manifests=(module_manifest,),
            )
            with zipfile.ZipFile(stage / ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED) as packed:
                for item in pristine.infolist():
                    packed.writestr(item, resources[item.filename] if item.filename in resources else pristine.read(item))
                for name in sorted(resources.keys() - set(pristine.namelist())):
                    packed.writestr(name, resources[name])
            with zipfile.ZipFile(stage / ARCHIVE) as packed:
                if packed.testzip() or any(packed.read(name) != data for name, data in resources.items()):
                    raise ValueError("Packaged Thunderbird resources differ from the integrated source.")

        installed = stage / DISTRIBUTION_XPI
        installed.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(xpi, installed)
        subprocess.run(["codesign", "--force", "--sign", "-",
                        "--preserve-metadata=identifier,entitlements,flags,runtime", stage], check=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", "--verbose=1", stage], check=True)

        stage.rename(output)
    print(f"{output}\n{len(resources)} verified Thunderbird resources and Thunderbolt {manifest['version']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("daily", type=Path, help="Pristine .app from the official November 23 Daily disk image")
    parser.add_argument("--xpi", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    package(options.daily, options.xpi, options.output)
