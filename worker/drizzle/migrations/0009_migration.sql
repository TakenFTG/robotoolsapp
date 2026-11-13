CREATE TABLE `TeamPhotoBlobs` (
	`photoId` text PRIMARY KEY NOT NULL,
	`contentType` text NOT NULL,
	`bytes` blob NOT NULL
);
