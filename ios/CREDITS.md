# Photo credits (KeyScrow for iOS)

The photos in the app are real and free to use. All thirteen come from [Wikimedia Commons](https://commons.wikimedia.org).
Each licence below was read from the file's own page on 26 November 2026 (the two that came to Commons from Flickr
carry Commons' passed licence review, FlickreviewR 2). None has a non-commercial or no-derivatives clause.

The same list is in the app (Settings > About > Photo credits) and in code
(`KeyEscrow/Design/Photos.swift`, `PhotoCatalog.credits`). `KeyEscrowTests/PhotoTests.swift` compares the three: the
image sets in the asset folder, the list in code and the table below must name the same photos with the same title,
author, licence and source.

The files are in `KeyEscrow/Resources/Assets.xcassets/Photos/` (about 2.5 MB in total). The listing photos are the
same photos as the website's catalogue (`web/data/listings.json`, served by `GET /api/listings`, credited on the
website's `/credits` page): the app shows the catalogue's photo from the server and keeps the bundled copy (by listing
slug) for offline use and while it loads. `KeyEscrowTests/PhotoTests.swift` checks that every catalogue listing has a
bundled copy credited exactly as the catalogue credits it.

## What the pictures are, and are not

They illustrate the demo listings. They do **not** show the exact scooters of the listings (those are demo data), and
the shops and places in them are not connected to KeyScrow. Where the model year or the place differs from the
listing, the "Note" column says so.

## The photos

| Used for | Asset | Title on Commons | Author | Licence | What we changed | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Home, top picture | `photo-hero-street` | [DZ6 1692 A row of parked motorbikes lines a quiet well-lit street at night as shops and signs glow under the awnings](https://commons.wikimedia.org/wiki/File:DZ6_1692_A_row_of_parked_motorbikes_lines_a_quiet_well-lit_street_at_night_as_shops_and_signs_glow_under_the_awnings.jpg) | PattayaPatrol (via Flickr) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Cropped to an upright 4:5 and resized to 1200 x 1500. Phone numbers on the shop signs and the print on a T-shirt are blurred. | A street in Pattaya, Thailand, at night. The shops in the picture are not connected to KeyScrow. |
| KeyScrow Mystery Box | `photo-mystery-box` | [Small Cardboard Moving Box Taped Closed (47303024341)](https://commons.wikimedia.org/wiki/File:Small_Cardboard_Moving_Box_Taped_Closed_(47303024341).jpg) | HireAHelper (via Flickr) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Cropped to a square and resized to 1200 x 1200. | A stand-in: not the box on the stage. |
| Honda Click 125i (`honda-click-125i`) | `photo-click-125i-cnx` | [Honda Click, Trang, Thailand](https://commons.wikimedia.org/wiki/File:Honda_Click,_Trang,_Thailand.jpg) | Vyacheslav Argenberg | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Cropped to a square and resized to 1200 x 1200. | A stand-in: an earlier Honda Click, photographed in Thailand in 2007, not the 125i of the listing. |
| Honda Scoopy (`honda-scoopy`) | `photo-scoopy-i-pai` | [2022 Honda Scoopy 110](https://commons.wikimedia.org/wiki/File:2022_Honda_Scoopy_110.jpg) | MoCars | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Cropped and resized to 1200 x 1200. | A 2022 Honda Scoopy 110, photographed in Bali. |
| Yamaha NMAX 155 (`yamaha-nmax-155`) | `photo-nmax-155-patong` | [2020 Yamaha NMAX 155 ABS (20200810) 01](https://commons.wikimedia.org/wiki/File:2020_Yamaha_NMAX_155_ABS_(20200810)_01.jpg) | オーバードライブ83 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Cropped to a square and resized to 1200 x 1200. | The same model as the listing. Photographed in Indonesia. |
| Honda PCX 160 (`honda-pcx-160`) | `photo-pcx-160-bkk` | [2025 Honda PCX 160 Roadsync Type](https://commons.wikimedia.org/wiki/File:2025_Honda_PCX_160_Roadsync_Type.jpg) | Chanokchon | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Resized to 1200 x 1200. | The same model as the listing, photographed at a dealer in Khon Kaen, Thailand. |
| Yamaha Fino 125 (`yamaha-fino-125`) | `photo-fino-125-bkk` | [Yamaha Fino](https://commons.wikimedia.org/wiki/File:Yamaha_Fino.jpg) | Addvisor | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Cropped to a square and resized to 1200 x 1200. | A Yamaha Fino photographed in Thailand; the model year may differ from the listing. |
| Vespa Primavera 150 (`vespa-primavera-150`) | `photo-vespa-primavera-150` | [2021 Vespa Primavera 75th, rear left](https://commons.wikimedia.org/wiki/File:2021_Vespa_Primavera_75th,_rear_left.jpg) | Mr.choppers | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | Cropped to a square and resized to 1200 x 1200. The number plate and the dealer's phone number on its frame are blurred. | A 2021 Primavera 125 (75th anniversary edition), the same body as the 150 of the listing, photographed in the United States. |
| Yamaha Grand Filano (`yamaha-grand-filano`) | `photo-grand-filano` | [2022 Yamaha Grand Filano Hybrid Connected](https://commons.wikimedia.org/wiki/File:2022_Yamaha_Grand_Filano_Hybrid_Connected.jpg) | Chanokchon | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Resized to 1200 x 1200. Two people in the background are blurred. | Photographed at a dealer in Khon Kaen, Thailand. |
| Destination tile: Bangkok | `place-bangkok` | [Bangkok skytrain sunset](https://commons.wikimedia.org/wiki/File:Bangkok_skytrain_sunset.jpg) | Diliff | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | Cropped to 4:3 and resized to 640 x 480. | |
| Destination tile: Chiang Mai | `place-chiang-mai` | [Tha Phae Gate 1](https://commons.wikimedia.org/wiki/File:Tha_Phae_Gate_1.jpg) | Christophe95 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Resized to 640 x 480. | |
| Destination tile: Pai | `place-pai` | [Thailand Pai (111310263)](https://commons.wikimedia.org/wiki/File:Thailand_Pai_(111310263).jpeg) | Andreas Gante (via 500px) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Cropped to 4:3 and resized to 640 x 480. | |
| Destination tile: Phuket | `place-phuket` | [Long-tail boats on Patong Beach Phuket](https://commons.wikimedia.org/wiki/File:Long-tail_boats_on_Patong_Beach_Phuket.jpg) | Arnaud-Victor Monteux | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Cropped to 4:3 and resized to 640 x 480. | |

All files were saved again as JPEG (quality about 80) without their original metadata.

## Licence of the changed versions

The cropped and resized versions in this repository are shared under the same licence as each original (this is what
the ShareAlike licences ask for; we do the same for the others). The app's code keeps its own licence
([`LICENSE`](../LICENSE)); the photos are separate works that the app only shows.

## Not a photo

The pickup and return pictures made in the Simulator ("Add a sample photo") are generated by the app
(`KeyEscrow/Features/Rent/Camera.swift`) and labelled as samples. On an iPhone they are the renter's own camera shots.
