import { config } from "../../package.json";

export { initLocale, getString, getLocaleID };

/**
 * Initialize locale data
 */
function initLocale() {
	// as seen in https://www.zotero.org/support/dev/zotero_7_for_developers#replacing_properties_files
	// do we "really need to generate a localized string completely outside the
	// context of a window"?
	const l10n = new (
		typeof Localization === "undefined"
			? ztoolkit.getGlobal("Localization")
			: Localization
	// using the Localization interface synchronously by passing true as the
	// second parameter to the constructor, though "strongly discouraged by
	// Mozilla"
	)([`${config.addonRef}-addon.ftl`], true);
	addon.data.locale = {
		current: l10n,
	};
}

/**
 * Get locale string, see https://firefox-source-docs.mozilla.org/l10n/fluent/tutorial.html#fluent-translation-list-ftl
 * @param localString ftl key
 * @param options.branch branch name
 * @param options.args args
 * @example
 * ```ftl
 * # addon.ftl
 * addon-static-example = This is default branch!
 *     .branch-example = This is a branch under addon-static-example!
 * addon-dynamic-example =
    { $count ->
        [one] I have { $count } apple
       *[other] I have { $count } apples
    }
 * ```
 * ```js
 * getString("addon-static-example"); // This is default branch!
 * getString("addon-static-example", { branch: "branch-example" }); // This is a branch under addon-static-example!
 * getString("addon-dynamic-example", { args: { count: 1 } }); // I have 1 apple
 * getString("addon-dynamic-example", { args: { count: 2 } }); // I have 2 apples
 * ```
 */
function getString(localString: string): string;
function getString(localString: string, branch: string): string;
function getString(
	localeString: string,
	options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
	if (inputs.length === 1) {
		return _getString(inputs[0]);
	} else if (inputs.length === 2) {
		if (typeof inputs[1] === "string") {
			return _getString(inputs[0], { branch: inputs[1] });
		} else {
			return _getString(inputs[0], inputs[1]);
		}
	} else {
		throw new Error("Invalid arguments");
	}
}

function _getString(
	localeString: string,
	options: {
		branch?: string | undefined;
		args?: Record<string, unknown>;
	} = {},
): string {
	const localStringWithPrefix = `${config.addonRef}-${localeString}`;
	const { branch, args } = options;
	const pattern = addon.data.locale?.current.formatMessagesSync([
		{ id: localStringWithPrefix, args },
	])[0];
	if (!pattern) {
		return localStringWithPrefix;
	}
	if (branch && pattern.attributes) {
		for (const attr of pattern.attributes) {
			if (attr.name === branch) {
				return attr.value;
			}
		}
		return pattern.attributes[branch] || localStringWithPrefix;
	} else {
		return pattern.value || localStringWithPrefix;
	}
}

function getLocaleID(id: string) {
	return `${config.addonRef}-${id}`;
}
