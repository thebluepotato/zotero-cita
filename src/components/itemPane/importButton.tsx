import * as React from "react";
import Citation from "../../cita/citation";
import Wikicite from "../../cita/wikicite";
import ToolbarButton from "./toolbarButton";
import PID from "../../cita/PID";

interface ImportButtonProps {
	citation: Citation;
}

function ImportButton(props: ImportButtonProps) {
	const citation = props.citation as Citation;
	const key = citation.target.key;
	const identifier = citation.target.getBestPID([
		"DOI",
		"arXiv",
		"ISBN",
		"OpenAlex",
	]);

	async function handleClick() {
		if (key) return; // Item was already linked and is therefore already present

		const libraryID = citation.source.item.libraryID;
		const collections = Zotero.Collections.getByLibrary(
			libraryID,
			true,
		).map((c) => {
			return { name: c.name, id: c.id };
		});
		collections.unshift({
			name: Zotero.Libraries.getName(libraryID),
			id: NaN,
		});

		// Select collection
		const selected: { value: number } = { value: 0 };
		let selectedCollectionID: number;
		if (collections && collections.length > 1) {
			const result = Services.prompt.select(
				window as mozIDOMWindowProxy,
				"Add to collection",
				"Select a collection to which to add the item or cancel",
				collections.map((c) => c.name),
				selected,
			);

			if (result) selectedCollectionID = collections[selected.value].id;
			else return; // User cancelled the action
		} else selectedCollectionID = NaN; // No collections to choose from

		// Import from with Zotero's lookup
		if (
			identifier &&
			(identifier.zoteroIdentifier || identifier.type === "OpenAlex")
		) {
			// Import from identifier
			const translation = new Zotero.Translate.Search();
			if (identifier.zoteroIdentifier)
				translation.setSearch(identifier.zoteroIdentifier);
			else if (identifier.type === "OpenAlex")
				translation.setSearch({ openAlex: identifier.id });

			// be lenient about translators
			const translators = await translation.getTranslators();
			translation.setTranslator(translators);
			try {
				const newItems: Zotero.Item[] = await translation.translate({
					libraryID: libraryID,
					collections: Number.isNaN(selectedCollectionID)
						? []
						: [selectedCollectionID],
				});
				switch (newItems.length) {
					case 0:
						break;
					case 1: {
						for (const pidType of PID.allTypes) {
							const pid = citation.target.getPID(pidType);
							if (pid !== null) {
								Wikicite.setExtraField(newItems[0], pidType, [
									pid.id,
								]);
								break;
							}
						}
						citation.linkToZoteroItem(newItems[0]);
						break;
					}
					default:
						await citation.autoLink();
				}
			} catch (e: any) {
				Zotero.logError(e);
			}
		} else {
			// There is no identifier but we do have a JSON item
			const library = Zotero.Libraries.get(libraryID);
			if (library) {
				const newItem =
					await citation.target.item.moveToLibrary(libraryID);
				if (selectedCollectionID)
					newItem.addToCollection(selectedCollectionID);
				citation.linkToZoteroItem(newItem);
			}
		}
	}

	const title = identifier ? "Import with identifier" : "Import data";
	const icon = identifier ? "magic-wand" : "add-item";

	return (
		!key && (
			<ToolbarButton
				className="zotero-clicky show-on-hover no-display"
				tabIndex={0}
				onClick={handleClick}
				title={title}
				imgSrc={`chrome://zotero/skin/20/universal/${icon}.svg`}
			/>
		)
	);
}

export default ImportButton;
